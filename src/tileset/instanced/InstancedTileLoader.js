import { LinkedHashMap } from 'js-utils-z';
import { B3DMDecoder } from "../../decoder/B3DMDecoder";
import * as THREE from 'three';
import { MeshTile } from './MeshTile';
import { JsonTile } from './JsonTile';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader";

let concurentDownloads = 0;

const zUpToYUpMatrix = new THREE.Matrix4();
zUpToYUpMatrix.set(1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1);

/**
* A Tile loader that manages caching and load order for instanced tiles.
* The cache is an LRU cache and is defined by the number of items it can hold.
* The actual number of cached items might grow beyond max if all items are in use.
* 
* The load order is designed for optimal perceived loading speed (nearby tiles are refined first).
*
* @param {scene} [scene] - a threejs scene.
* @param {Object} [options] - Optional configuration object.
* @param {number} [options.maxCachedItems=100] - the cache size.
* @param {number} [options.maxInstances=1] - the cache size.
* @param {function} [options.meshCallback] - A callback to call on newly decoded meshes.
* @param {function} [options.pointsCallback] - A callback to call on newly decoded points.
* @param {renderer} [options.renderer] - The renderer, this is required for KTX2 support.
* @param {sring} [options.proxy] - An optional proxy that tile requests will be directed too as POST requests with the actual tile url in the body of the request.
*/
class InstancedTileLoader {
    constructor(scene, options) {
        this.maxCachedItems = 100;
        this.maxInstances = 1;
        this.proxy = options.proxy;
        if (!!options) {
            this.meshCallback = options.meshCallback;
            this.pointsCallback = options.pointsCallback;
            if (options.maxCachedItems) this.maxCachedItems = options.maxCachedItems;
            if (options.maxInstances) this.maxInstances = options.maxInstances;
            
        }
        this.gltfLoader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.3/');
        this.gltfLoader.setDRACOLoader(dracoLoader);

        if(!!options && !!options.renderer){
            const ktx2Loader = new KTX2Loader();
            ktx2Loader.setTranscoderPath('https://storage.googleapis.com/ogc-3d-tiles/basis/').detectSupport(options.renderer);
            this.gltfLoader.setKTX2Loader(ktx2Loader);

            this.b3dmDecoder=new B3DMDecoder(options.renderer);
        }else{
            this.b3dmDecoder=new B3DMDecoder(null);
        }

        this.cache = new LinkedHashMap();
        this.scene = scene;

        this.ready = [];
        this.downloads = [];
        this.nextReady = [];
        this.nextDownloads = [];
        this.init();
    }

    
    update() {
        const self = this;

        self.cache._data.forEach(v => {
            v.update();
        })

    }
    init() {

        const self = this;
        setIntervalAsync(() => {
            self.download();
        }, 10);
        setIntervalAsync(() => {
            const start = Date.now();
            let loaded = 0;
            do {
                loaded = self.loadBatch();
            } while (loaded > 0 && (Date.now() - start) <= 0)

        }, 10);
    }

    download() {
        const self = this;
        if (self.nextDownloads.length == 0) {
            self.getNextDownloads();
            if (self.nextDownloads.length == 0) return;
        }
        while (self.nextDownloads.length > 0 && concurentDownloads < 500) {
            const nextDownload = self.nextDownloads.shift();
            if (!!nextDownload && nextDownload.shouldDoDownload()) {
                //nextDownload.doDownload();
                concurentDownloads++;
                if (nextDownload.path.includes(".b3dm")) {
                    var fetchFunction;
                    if (!self.proxy) {
                        fetchFunction = () => {
                            return fetch(nextDownload.path, { signal: nextDownload.abortController.signal });
                        }
                    } else {
                        fetchFunction = () => {
                            return fetch(self.proxy,
                                {
                                    method: 'POST',
                                    body: nextDownload.path,
                                    signal: nextDownload.abortController.signal
                                }
                            );
                        }
                    }
                    fetchFunction().then(result => {
                        concurentDownloads--;
                        if (!result.ok) {
                            console.error("could not load tile with path : " + nextDownload.path)
                            throw new Error(`couldn't load "${nextDownload.path}". Request failed with status ${result.status} : ${result.statusText}`);
                        }
                        return result.arrayBuffer();

                    })
                        .then(resultArrayBuffer => {
                            return this.b3dmDecoder.parseB3DMInstanced(resultArrayBuffer, self.meshCallback, self.maxInstances, nextDownload.zUpToYUp);
                        })
                        .then(mesh => {
                            nextDownload.tile.setObject(mesh);
                            self.ready.unshift(nextDownload);

                        })
                        .catch(e => console.error(e));
                } if (nextDownload.path.includes(".glb") || (nextDownload.path.includes(".gltf"))) {
                    var fetchFunction;
                    if (!self.proxy) {
                        fetchFunction = () => {
                            return fetch(nextDownload.path, { signal: nextDownload.abortController.signal });
                        }
                    } else {
                        fetchFunction = () => {
                            return fetch(self.proxy,
                                {
                                    method: 'POST',
                                    body: nextDownload.path,
                                    signal: nextDownload.abortController.signal
                                }
                            );
                        }
                    }
                    fetchFunction().then(result=>{
                        return result.arrayBuffer();
                    }).then(arrayBuffer=>{
                        this.gltfLoader.parse(arrayBuffer, gltf => {
                            gltf.scene.asset = gltf.asset;
                            if (nextDownload.zUpToYUp) {
                                gltf.scene.applyMatrix4(zUpToYUpMatrix);
                            }
                            gltf.scene.traverse((o) => {
                                o.geometricError = nextDownload.geometricError;
                                if (o.isMesh) {
                                    
                                    if (!!self.meshCallback) {
                                        self.meshCallback(o);
                                    }
                                }
                                if (o.isPoints) {
                                    console.error("instanced point cloud is not supported");
                                }
                            });
                            let instancedMesh;
                            gltf.scene.updateWorldMatrix(false, true)
                            gltf.scene.traverse(child => {
                                //TODO several meshes in a single gltf
                                if (child.isMesh) {
                                    instancedMesh = new THREE.InstancedMesh(child.geometry, child.material, self.maxInstances);
                                    instancedMesh.baseMatrix = child.matrixWorld;
                                }
    
                            });
                            self.ready.unshift(nextDownload);
                            if (!instancedMesh) {
                                gltf.scene.traverse(c => {
                                    if (c.dispose) c.dispose();
                                    if (c.material) c.material.dispose();
                                });
                            } else {
                                nextDownload.tile.setObject(instancedMesh);
                            }
                        });
                    },e=>{
                        throw new Error("could not load tile : "+nextDownload.path)
                    });

                    

                } else if (nextDownload.path.includes(".json")) {
                    concurentDownloads++;
                    var fetchFunction;
                    if (!self.proxy) {
                        fetchFunction = () => {
                            return fetch(nextDownload.path, { signal: nextDownload.abortController.signal });
                        }
                    } else {
                        fetchFunction = () => {
                            return fetch(self.proxy,
                                {
                                    method: 'POST',
                                    body: nextDownload.path,
                                    signal: nextDownload.abortController.signal
                                }
                            );
                        }
                    }
                    fetchFunction().then(result => {
                        concurentDownloads--;
                        if (!result.ok) {
                            console.error("could not load tile with path : " + nextDownload.path)
                            throw new Error(`couldn't load "${nextDownload.path}". Request failed with status ${result.status} : ${result.statusText}`);
                        }
                        return result.json();

                    }).then(json => {
                        nextDownload.tile.setObject(json, nextDownload.path);
                        self.ready.unshift(nextDownload);
                    })
                        .catch(e => console.error(e))
                }
            }
        }
        return;
    }

    loadBatch() {
        if (this.nextReady.length == 0) {
            this.getNextReady();
            if (this.nextReady.length == 0) return 0;
        }
        const download = this.nextReady.shift();
        if (!download) return 0;

        if (!!download.tile.addToScene) download.tile.addToScene();
        return 1;
    }

    getNextReady() {
        let smallestDistance = Number.MAX_VALUE;
        let closest = -1;
        for (let i = this.ready.length - 1; i >= 0; i--) {

            if (!this.ready[i].distanceFunction) {// if no distance function, must be a json, give absolute priority!
                this.nextReady.push(this.ready.splice(i, 1)[0]);
            }
        }
        if (this.nextReady.length > 0) return;
        for (let i = this.ready.length - 1; i >= 0; i--) {
            const dist = this.ready[i].distanceFunction() * this.ready[i].level;
            if (dist < smallestDistance) {
                smallestDistance = dist;
                closest = i
            }
        }
        if (closest >= 0) {
            const closestItem = this.ready.splice(closest, 1).pop();
            this.nextReady.push(closestItem);
            const siblings = closestItem.getSiblings();
            for (let i = this.ready.length - 1; i >= 0; i--) {
                if (siblings.includes(this.ready[i].uuid)) {
                    this.nextready.push(this.ready.splice(i, 1).pop());
                }
            }
        }
    }

    get(abortController, path, uuid, instancedOGC3DTile, distanceFunction, getSiblings, level, zUpToYUp, geometricError) {
        const self = this;
        const key = simplifyPath(path);

        if (!path.includes(".b3dm") && !path.includes(".json") && !path.includes(".glb") && !path.includes(".gltf")) {
            console.error("the 3DTiles cache can only be used to load B3DM, gltf and json data");
            return;
        }

        const cachedTile = self.cache.get(key);
        if (!!cachedTile) {
            cachedTile.addInstance(instancedOGC3DTile);
            return;
        } else {

            if (path.includes(".b3dm") || path.includes(".glb") || path.includes(".gltf")) {
                const tile = new MeshTile(self.scene);
                tile.addInstance(instancedOGC3DTile);

                self.cache.put(key, tile);

                const realAbortController = new AbortController();
                abortController.signal.addEventListener("abort", () => {
                    if (tile.getCount() == 0) {
                        realAbortController.abort();
                    }
                })
                this.downloads.push({
                    abortController: realAbortController,
                    tile: tile,
                    key: key,
                    path: path,
                    distanceFunction: distanceFunction,
                    getSiblings: getSiblings,
                    level: level,
                    uuid: uuid,
                    zUpToYUp: zUpToYUp,
                    geometricError: geometricError,
                    shouldDoDownload: () => {
                        return true;
                    },
                })
            } else if (path.includes(".json")) {
                const tile = new JsonTile();
                tile.addInstance(instancedOGC3DTile);
                self.cache.put(key, tile);

                const realAbortController = new AbortController();
                abortController.signal.addEventListener("abort", () => {
                    if (tile.getCount() == 0) {
                        realAbortController.abort();
                    }
                })
                this.downloads.push({
                    abortController: realAbortController,
                    tile: tile,
                    key: key,
                    path: path,
                    distanceFunction: distanceFunction,
                    getSiblings: getSiblings,
                    level: level,
                    shouldDoDownload: () => {
                        return true;
                    },
                })

            }
        }
    }



    getNextDownloads() {
        let smallestDistance = Number.MAX_VALUE;
        let closest = -1;
        for (let i = this.downloads.length - 1; i >= 0; i--) {
            const download = this.downloads[i];
            if (!download.shouldDoDownload()) {
                this.downloads.splice(i, 1);
                continue;
            }
            if (!download.distanceFunction) { // if no distance function, must be a json, give absolute priority!
                this.nextDownloads.push(this.downloads.splice(i, 1)[0]);
            }
        }
        if (this.nextDownloads.length > 0) return;
        for (let i = this.downloads.length - 1; i >= 0; i--) {
            const download = this.downloads[i];
            const dist = download.distanceFunction() * download.level;
            if (dist < smallestDistance) {
                smallestDistance = dist;
                closest = i;
            }
        }
        if (closest >= 0) {
            const closestItem = this.downloads.splice(closest, 1).pop();
            this.nextDownloads.push(closestItem);
            const siblings = closestItem.getSiblings();
            for (let i = this.downloads.length - 1; i >= 0; i--) {
                if (siblings.includes(this.downloads[i].uuid)) {
                    this.nextDownloads.push(this.downloads.splice(i, 1).pop());
                }
            }
        }
    }

    checkSize() {
        const self = this;

        let i = 0;

        while (self.cache.size() > self.maxCachedItems && i < self.cache.size()) {
            i++;
            const entry = self.cache.head();
            if (entry.value.getCount() > 0) {
                self.cache.remove(entry.key);
                self.cache.put(entry.key, entry.value);
            } else {
                self.cache.remove(entry.key);
                if (entry.value.instancedMesh) {
                    entry.value.instancedMesh.traverse((o) => {
                        if (o.material) {
                            // dispose materials
                            if (o.material.length) {
                                for (let i = 0; i < o.material.length; ++i) {
                                    o.material[i].dispose();
                                }
                            }
                            else {
                                o.material.dispose()
                            }
                        }
                        if (o.geometry) {
                            // dispose geometry
                            o.geometry.dispose();
                        }
                    });
                }
            }

        }
    }
}
function setIntervalAsync(fn, delay) {
    let timeout;

    const run = async () => {
        const startTime = Date.now();
        try {
            await fn();
        } catch (err) {
            console.error(err);
        } finally {
            const endTime = Date.now();
            const elapsedTime = endTime - startTime;
            const nextDelay = elapsedTime >= delay ? 0 : delay - elapsedTime;
            timeout = setTimeout(run, nextDelay);
        }
    };

    timeout = setTimeout(run, delay);

    return { clearInterval: () => clearTimeout(timeout) };
}
function simplifyPath(main_path) {

    var parts = main_path.split('/'),
        new_path = [],
        length = 0;
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (part === '.' || part === '' || part === '..') {
            if (part === '..' && length > 0) {
                length--;
            }
            continue;
        }
        new_path[length++] = part;
    }

    if (length === 0) {
        return '/';
    }

    var result = '';
    for (var i = 0; i < length; i++) {
        result += '/' + new_path[i];
    }

    return result;
}

export { InstancedTileLoader };