// Voxel Dog 3D Component
// Based on https://github.com/craftzdog/craftzdog-homepage
// Converted from React to vanilla JavaScript

(function() {
  'use strict';

  // Wait for DOM to be ready
  function init() {
    const container = document.getElementById('voxel-dog-container');
    if (!container) return;

    // Check if Three.js is loaded
    if (typeof THREE === 'undefined') {
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', function() {
        loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js', function() {
          loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js', function() {
            loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js', startVoxelDog);
          });
        });
      });
    } else {
      startVoxelDog();
    }

    function startVoxelDog() {
      new VoxelDog(container);
    }
  }

  function loadScript(src, callback) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = callback;
    script.onerror = function() {
      console.error('Failed to load:', src);
    };
    document.head.appendChild(script);
  }

  // Easing function from original code
  function easeOutCirc(x) {
    return Math.sqrt(1 - Math.pow(x - 1, 4));
  }

  // VoxelDog Class - mirrors the React component logic
  class VoxelDog {
    constructor(container) {
      this.container = container;
      this.refRenderer = null;
      this.req = null;
      this.frame = 0;
      this.loading = true;
      
      // Camera settings from original
      this.target = new THREE.Vector3(-0.5, 1.2, 0);
      this.initialCameraPosition = new THREE.Vector3(
        20 * Math.sin(0.2 * Math.PI),
        10,
        20 * Math.cos(0.2 * Math.PI)
      );

      this.init();
    }

    init() {
      const scW = this.container.clientWidth;
      const scH = this.container.clientHeight;

      // Create renderer with alpha background
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
      });
      renderer.setClearColor(0x000000, 0); // Transparent background
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(scW, scH);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      this.container.appendChild(renderer.domElement);
      this.refRenderer = renderer;

      // Create scene
      const scene = new THREE.Scene();

      // Scale calculation from original: scH * 0.005 + 4.8
      const scale = scH * 0.005 + 4.8;
      const camera = new THREE.OrthographicCamera(
        -scale,
        scale,
        scale,
        -scale,
        0.01,
        50000
      );
      camera.position.copy(this.initialCameraPosition);
      camera.lookAt(this.target);

      // Ambient light - reduced intensity to prevent overexposure
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      // Add directional light for better shading
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(10, 20, 10);
      scene.add(dirLight);

      // Add fill light from opposite side
      const fillLight = new THREE.DirectionalLight(0xffecd1, 0.4);
      fillLight.position.set(-10, 10, -10);
      scene.add(fillLight);

      // OrbitControls from original
      const controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.autoRotate = true;
      controls.target = this.target;

      // Load the model
      this.loadGLTFModel(scene, '/dog.glb', {
        receiveShadow: false,
        castShadow: false
      }).then(() => {
        this.animate(renderer, scene, camera, controls);
        this.setLoading(false);
      }).catch(error => {
        console.error('Failed to load dog model:', error);
        this.setLoading(false);
      });

      // Handle resize
      window.addEventListener('resize', () => this.handleWindowResize(), false);
    }

    loadGLTFModel(scene, glbPath, options = { receiveShadow: true, castShadow: true }) {
      const { receiveShadow, castShadow } = options;
      
      return new Promise((resolve, reject) => {
        const loader = new THREE.GLTFLoader();
        
        // Setup DRACO loader if available
        if (THREE.DRACOLoader) {
          const draco = new THREE.DRACOLoader();
          draco.setDecoderConfig({ type: 'js' });
          draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
          loader.setDRACOLoader(draco);
        }

        loader.load(
          glbPath,
          (gltf) => {
            const obj = gltf.scene;
            obj.name = 'dog';
            obj.position.y = 0;
            obj.position.x = 0;
            obj.receiveShadow = receiveShadow;
            obj.castShadow = castShadow;
            scene.add(obj);

            obj.traverse(function(child) {
              if (child.isMesh) {
                child.castShadow = castShadow;
                child.receiveShadow = receiveShadow;
              }
            });
            resolve(obj);
          },
          undefined,
          (error) => reject(error)
        );
      });
    }

    animate(renderer, scene, camera, controls) {
      const animate = () => {
        this.req = requestAnimationFrame(animate);

        this.frame = this.frame <= 100 ? this.frame + 1 : this.frame;

        // Initial rotation animation from original code
        if (this.frame <= 100) {
          const p = this.initialCameraPosition;
          const rotSpeed = -easeOutCirc(this.frame / 120) * Math.PI * 20;

          camera.position.y = 10;
          camera.position.x = p.x * Math.cos(rotSpeed) + p.z * Math.sin(rotSpeed);
          camera.position.z = p.z * Math.cos(rotSpeed) - p.x * Math.sin(rotSpeed);
          camera.lookAt(this.target);
        } else {
          controls.update();
        }

        renderer.render(scene, camera);
      };

      animate();
    }

    handleWindowResize() {
      const renderer = this.refRenderer;
      const container = this.container;
      if (container && renderer) {
        const scW = container.clientWidth;
        const scH = container.clientHeight;
        renderer.setSize(scW, scH);
      }
    }

    setLoading(isLoading) {
      this.loading = isLoading;
      const spinner = document.getElementById('dog-spinner');
      if (spinner) {
        spinner.style.display = isLoading ? 'flex' : 'none';
      }
    }

    destroy() {
      if (this.req) {
        cancelAnimationFrame(this.req);
      }
      if (this.refRenderer) {
        this.refRenderer.domElement.remove();
        this.refRenderer.dispose();
      }
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
