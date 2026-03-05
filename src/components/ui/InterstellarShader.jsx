import { useEffect, useRef } from "react"
import * as THREE from "three"
import { hexToRgb } from "@/lib/utils"

/**
 * Interstellar shader — mosaic beam lines.
 * @param {{ color?: string }} props - Hex accent color (default: "#14b8a6")
 */
export function InterstellarShader({ color = "#14b8a6" }) {
    const containerRef = useRef(null)
    const sceneRef = useRef(null)
    const colorRef = useRef(hexToRgb(color))

    useEffect(() => {
        colorRef.current = hexToRgb(color)
        if (sceneRef.current?.uniforms?.uAccent) {
            sceneRef.current.uniforms.uAccent.value.set(...colorRef.current)
        }
    }, [color])

    useEffect(() => {
        if (!containerRef.current) return
        const container = containerRef.current

        const vertexShader = `
      void main() {
        gl_Position = vec4( position, 1.0 );
      }
    `

        const fragmentShader = `
      #define TWO_PI 6.2831853072
      #define PI 3.14159265359

      precision highp float;
      uniform vec2 resolution;
      uniform float time;
      uniform vec3 uAccent;

      float random (in float x) {
        return fract(sin(x)*1e4);
      }
      float random (vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
      }

      void main(void) {
        vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);

        vec2 fMosaicScal = vec2(4.0, 2.0);
        vec2 vScreenSize = vec2(256.0, 256.0);
        uv.x = floor(uv.x * vScreenSize.x / fMosaicScal.x) / (vScreenSize.x / fMosaicScal.x);
        uv.y = floor(uv.y * vScreenSize.y / fMosaicScal.y) / (vScreenSize.y / fMosaicScal.y);

        float t = time*0.06 + random(uv.x)*0.4;
        float lineWidth = 0.0008;

        vec3 intensity = vec3(0.0);
        for(int j = 0; j < 3; j++){
          for(int i=0; i < 5; i++){
            intensity[j] += lineWidth*float(i*i) / abs(fract(t - 0.01*float(j)+float(i)*0.01)*1.0 - length(uv));
          }
        }

        // Compute brightness, tint with accent color
        float brightness = max(max(intensity[0], intensity[1]), intensity[2]);
        gl_FragColor = vec4(brightness * uAccent, 1.0);
      }
    `

        const camera = new THREE.Camera()
        camera.position.z = 1
        const scene = new THREE.Scene()
        const geometry = new THREE.PlaneGeometry(2, 2)

        const rgb = colorRef.current
        const uniforms = {
            time: { type: "f", value: 1.0 },
            resolution: { type: "v2", value: new THREE.Vector2() },
            uAccent: { type: "v3", value: new THREE.Vector3(rgb[0], rgb[1], rgb[2]) },
        }

        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader,
            fragmentShader,
        })

        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(window.devicePixelRatio)
        container.appendChild(renderer.domElement)

        const onWindowResize = () => {
            const width = container.clientWidth
            const height = container.clientHeight
            renderer.setSize(width, height)
            uniforms.resolution.value.x = renderer.domElement.width
            uniforms.resolution.value.y = renderer.domElement.height
        }
        onWindowResize()
        window.addEventListener("resize", onWindowResize, false)

        const animate = () => {
            const animationId = requestAnimationFrame(animate)
            uniforms.time.value += 0.05
            const c = colorRef.current
            uniforms.uAccent.value.set(c[0], c[1], c[2])
            renderer.render(scene, camera)
            if (sceneRef.current) sceneRef.current.animationId = animationId
        }

        sceneRef.current = { camera, scene, renderer, uniforms, animationId: 0 }
        animate()

        return () => {
            window.removeEventListener("resize", onWindowResize)
            if (sceneRef.current) {
                cancelAnimationFrame(sceneRef.current.animationId)
                if (container && sceneRef.current.renderer.domElement) {
                    container.removeChild(sceneRef.current.renderer.domElement)
                }
                sceneRef.current.renderer.dispose()
                geometry.dispose()
                material.dispose()
            }
        }
    }, [])

    return (
        <div
            ref={containerRef}
            className="w-full h-screen"
            style={{ background: "#000", overflow: "hidden" }}
        />
    )
}
