import "regenerator-runtime/runtime.js";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { OGC3DTile } from "./tileset/OGC3DTile";
import { TileLoader } from "./tileset/TileLoader";
import {
    MapControls,
    OrbitControls,
} from "three/examples/jsm/controls/OrbitControls.js";
import { OcclusionCullingService } from "./tileset/OcclusionCullingService";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";

import { InstancedOGC3DTile } from "./tileset/instanced/InstancedOGC3DTile.js";
import { InstancedTileLoader } from "./tileset/instanced/InstancedTileLoader.js";
import { Sky } from "three/examples/jsm/objects/Sky";

const occlusionCullingService = new OcclusionCullingService();
occlusionCullingService.setSide(THREE.DoubleSide);
const scene = initScene();

const domContainer = initDomContainer("screen");
const camera = initCamera(domContainer.offsetWidth, domContainer.offsetHeight);
const stats = initStats(domContainer);
const renderer = initRenderer(camera, domContainer);
const ogc3DTiles = initTileset(scene, 0.3);

//const instancedTileLoader = createInstancedTileLoader(scene);
//const ogc3DTiles = initInstancedTilesets(instancedTileLoader);

/*const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.3/');
gltfLoader.setDRACOLoader(dracoLoader);

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('jsm/libs/basis/');
//gltfLoader.setKTX2Loader(ktx2Loader)


gltfLoader.load(
    // resource URL
    'http://localhost:8080/3/15.glb',
    // called when the resource is loaded
    function (gltf) {

        scene.add(gltf.scene);

    },
    // called while loading is progressing
    function (xhr) {

        console.log((xhr.loaded / xhr.total * 100) + '% loaded');

    },
    // called when loading has errors
    function (error) {

        console.log('An error happened : ' + error);

    }
);*/
// Optional: Provide a DRACOLoader instance to decode compressed mesh data

const controller = initController(camera, domContainer);

const composer = initComposer(scene, camera, renderer);

animate();

let sky, sun;
initSky();
function initSky() {
    sky = new Sky();
    sky.scale.setScalar(450000);
    scene.add(sky);

    sun = new THREE.Vector3();

    const effectController = {
        turbidity: 10,
        rayleigh: 1,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.3,
        elevation: 5,
        azimuth: 40,
        exposure: renderer.toneMappingExposure,
    };

    const uniforms = sky.material.uniforms;
    uniforms["turbidity"].value = effectController.turbidity;
    uniforms["rayleigh"].value = effectController.rayleigh;
    uniforms["mieCoefficient"].value = effectController.mieCoefficient;
    uniforms["mieDirectionalG"].value = effectController.mieDirectionalG;

    const phi = THREE.MathUtils.degToRad(90 - effectController.elevation);
    const theta = THREE.MathUtils.degToRad(effectController.azimuth);

    sun.setFromSphericalCoords(1, phi, theta);

    uniforms["sunPosition"].value.copy(sun);

    renderer.toneMappingExposure = effectController.exposure;
    renderer.render(scene, camera);
}
function initComposer(scene, camera, renderer) {
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.15,
        0.2,
        0
    );

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    return composer;
}
function initScene() {
    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false;
    //scene.matrixWorldAutoUpdate = false;
    scene.background = new THREE.Color(0xe5e3e4);
    //const dirLight = new THREE.DirectionalLight(0xFFFFFF, 1.0);
    //dirLight.position.set(100,100,100);
    //dirLight.lookAt(new THREE.Vector3(0,0,0));
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    //scene.add(dirLight)

    /* const light = new THREE.PointLight(0xbbbbff, 2, 5000);
    const sphere = new THREE.SphereGeometry(2, 16, 8);
    light.add(new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xbbbbff })));
    scene.add(light);
    light.position.set(200, 200, 200);


    const light2 = new THREE.PointLight(0xffbbbb, 2, 5000);
    const sphere2 = new THREE.SphereGeometry(2, 16, 8);
    light2.add(new THREE.Mesh(sphere2, new THREE.MeshBasicMaterial({ color: 0xffbbbb })));
    scene.add(light2);
    light2.position.set(200, 100, -100); */

    return scene;
}

function initDomContainer(divID) {
    const domContainer = document.getElementById(divID);
    domContainer.style =
        "position: absolute; height:100%; width:100%; left: 0px; top:0px;";
    document.body.appendChild(domContainer);
    return domContainer;
}

function initRenderer(camera, dom) {
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(dom.offsetWidth, dom.offsetHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    //renderer.toneMapping = THREE.ReinhardToneMapping;
    //renderer.toneMappingExposure = Math.pow(0.8, 4.0);
    renderer.autoClear = false;

    dom.appendChild(renderer.domElement);

    onWindowResize();
    window.addEventListener("resize", onWindowResize);
    function onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();

        renderer.setSize(dom.offsetWidth, dom.offsetHeight);
    }

    return renderer;
}

function initStats(dom) {
    const stats = Stats();
    document.body.appendChild(stats.dom);
    return stats;
}

function initTileset(scene, gem) {
    const tileLoader = new TileLoader({
        renderer: renderer,
        maxCachedItems: 1000,
        meshCallback: (mesh) => {
            //// Insert code to be called on every newly decoded mesh e.g.:
            mesh.material.wireframe = false;
            mesh.material.side = THREE.DoubleSide;
            //mesh.material.transparent = true
            //mesh.material.needsUpdate = true
            //mesh.material.metalness = 0.0
        },
        pointsCallback: (points) => {
            points.material.size = Math.min(
                1.0,
                0.1 * Math.sqrt(points.geometricError)
            );
            points.material.sizeAttenuation = true;
        },
    });

    const ogc3DTile = new OGC3DTile({
        // url: "https://tile.googleapis.com/v1/3dtiles/datasets/CgA/files/UlRPVEYuYnVsa21ldGFkYXRhLnBsYW5ldG9pZD1lYXJ0aCxidWxrX21ldGFkYXRhX2Vwb2NoPTk0NixwYXRoPSxjYWNoZV92ZXJzaW9uPTY.json",
        // url: "https://storage.googleapis.com/ogc-3d-tiles/berlinTileset/tileset.json",
        //url: "https://storage.googleapis.com/ogc-3d-tiles/ayutthaya/tiledWithSkirts/tileset.json",
        //url: "https://storage.googleapis.com/ogc-3d-tiles/ladybug/tileset.json",
        //url: "https://storage.googleapis.com/ogc-3d-tiles/museumPoints/tileset.json",
        //url: "https://storage.googleapis.com/ogc-3d-tiles/museumMeshed/tileset.json",
        url: "https://tile.googleapis.com/v1/3dtiles/root.json",
        queryParams: {
            key: "AIzaSyBYD6WicsqFZmxp31EibRw868--YppdNIQ",
            // session: "CO-cpIrQ5pr0kgE",
        },
        geometricErrorMultiplier: gem,
        loadOutsideView: true,
        tileLoader: tileLoader,
        //occlusionCullingService: occlusionCullingService,
        static: false,
        centerModel: true,
        renderer: renderer,
        yUp: true,
        //zUp: true,
        displayErrors: true,
        displayCopyright: true,
    });
    setIntervalAsync(function () {
        ogc3DTile.update(camera);
    }, 10);

    ogc3DTile.scale.set(0.001, 0.001, 0.001);

    ogc3DTile.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI * -0.5);
    //ogc3DTile.translateOnAxis(new THREE.Vector3(0, 0, 1), 1)
    /* 
    ogc3DTile.translateOnAxis(new THREE.Vector3(0, 0, 1), 10) // Z-UP to Y-UP
    ogc3DTile.translateOnAxis(new THREE.Vector3(0, 1, 0), 18.5) // Z-UP to Y-UP */
    scene.add(ogc3DTile);

    return ogc3DTile;
}

function createInstancedTileLoader(scene) {
    return new InstancedTileLoader(scene, {
        renderer: renderer,
        maxCachedItems: 100,
        maxInstances: 1,
        meshCallback: (mesh) => {
            //// Insert code to be called on every newly decoded mesh e.g.:
            mesh.material.wireframe = true;
            mesh.material.side = THREE.DoubleSide;
        },
        pointsCallback: (points) => {
            points.material.size = Math.min(
                1.0,
                0.5 * Math.sqrt(points.geometricError)
            );
            points.material.sizeAttenuation = true;
        },
    });
}
function initInstancedTilesets(instancedTileLoader) {
    /*new GLTFLoader().load('http://localhost:8080/test.glb', function ( gltf ) {
        scene.add(gltf.scene);
    } );*/

    const instancedTilesets = [];

    const tileset = new InstancedOGC3DTile({
        //url: "https://storage.googleapis.com/ogc-3d-tiles/berlinTileset/tileset.json",
        url: "http://localhost:8080/tileset.json",
        geometricErrorMultiplier: 1000,
        loadOutsideView: false,
        tileLoader: instancedTileLoader,
        static: false,
        centerModel: true,
        renderer: renderer,
    });
    tileset.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI * 0.5); // Z-UP to Y-UP

    tileset.updateMatrix();
    scene.add(tileset);
    instancedTilesets.push(tileset);

    scene.updateMatrixWorld(true);
    function now() {
        return (typeof performance === "undefined" ? Date : performance).now();
    }
    let updateIndex = 0;
    setInterval(() => {
        let startTime = now();
        do {
            const frustum = new THREE.Frustum();
            frustum.setFromProjectionMatrix(
                new THREE.Matrix4().multiplyMatrices(
                    camera.projectionMatrix,
                    camera.matrixWorldInverse
                )
            );
            instancedTilesets[updateIndex].update(camera, frustum);
            updateIndex = (updateIndex + 1) % instancedTilesets.length;
        } while (
            updateIndex < instancedTilesets.length &&
            now() - startTime < 4
        );
    }, 40);

    //initLODMultiplierSlider(instancedTilesets);
}

// Add an event listener to handle mouse movement
document.addEventListener("mousemove", onDocumentMouseMove, false);

// Variables to store the mouse position
let mouseX = 0,
    mouseY = 0;

// Function to update the mouse position
function onDocumentMouseMove(event) {
    mouseX = event.clientX - window.innerWidth / 2;
    mouseY = event.clientY - window.innerHeight / 2;
}

function initCamera(width, height) {
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.001, 3000);
    //camera.position.set(3973.55, 4973.8, 3.2851604304346775);
    camera.position.set(
        -3811.5593088164296,
        3654.0453377454273,
        -3566.9588863624026
    );
    // camera.position.set(0, 0, 0)
    //camera.up.set(0, 1, 0);

    camera.lookAt(0, 0, 0);

    camera.matrixAutoUpdate = true;
    camera.updateProjectionMatrix();

    document.addEventListener("keydown", function (event) {
        if (event.key === "p") {
            console.log(camera.position);
        }
    });

    return camera;
}

function initController(camera, dom) {
    const controller = new OrbitControls(camera, dom);

    //controller.target.set(4629210.73133627, 435359.7901640832, 4351492.357788198);
    //controller.target.set(0, 0, 0);

    //   controller.minDistance = 0.1;
    //   controller.maxDistance = 30000;
    controller.rotateSpeed = 0.0001;
    controller.zoomSpeed = 0.002;
    controller.panSpeed = 0.002;

    controller.enableRotate = true;

    controller.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
    };

    controller.target.set(1, 0, 0);
    controller.enabled = true;

    const initialDistance = camera.position.distanceTo(controller.target);

    //   // Add listener to the change event
    //   controller.addEventListener('change', () => {
    //     const vector = camera.position.clone();
    //     console.log('vector::::', vector);
    //     // const currentDistance = camera.position.distanceTo(controller.target);
    //     // console.log('currentDistance', currentDistance, initialDistance);
    //     // const delta = Math.pow(Math.abs(currentDistance - initialDistance), 2);
    //     // // Calculate the zoom level based on the currentDistance
    //     // const zoomLevel = currentDistance / initialDistance;
    //     // console.log('delta::::', delta);
    //     // // Adjust rotateSpeed and zoomSpeed based on the zoomLevel
    //     // const rotateSpeed = 0.2 / delta;
    //     // const zoomSpeed = 0.0001 / delta;
    //     // console.log('rotateSpeed, zoomSpeed', rotateSpeed, zoomSpeed);
    //     // // Apply the updated speed values
    //     // // controller.rotateSpeed = rotateSpeed;
    //     // controller.zoomSpeed = zoomSpeed;
    //   });

    controller.update();
    return controller;
}

function animate() {
    requestAnimationFrame(animate);

    //   controller.target.x = mouseX;
    //   controller.target.y = mouseY;

    controller.update();

    //instancedTileLoader.update();
    composer.render();
    //occlusionCullingService.update(scene, renderer, camera)
    stats.update();
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
