import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import presentModelUrl from '../assets/models/new-gift.glb?url'

type GiftSize = 'nav' | 'modal'

const giftConfigs: Record<GiftSize, {
  wrapperClassName: string
  glowClassName: string
  targetSize: number
  cameraZ: number
  cameraY: number
  lookAtY: number
  yOffset: number
}> = {
  nav: {
    wrapperClassName: 'w-[72px] h-[78px] -mt-6 -mb-3 -mr-3',
    glowClassName: 'h-10 w-10',
    targetSize: 1.24,
    cameraZ: 3.9,
    cameraY: 1.42,
    lookAtY: 0,
    yOffset: -0.36,
  },
  modal: {
    wrapperClassName: 'h-44 w-44',
    glowClassName: 'h-32 w-32',
    targetSize: 1.56,
    cameraZ: 4.55,
    cameraY: 1.55,
    lookAtY: 0.02,
    yOffset: -0.56,
  },
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function GiftFallback({ size }: { size: GiftSize }) {
  const config = giftConfigs[size]

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        aria-hidden="true"
        className={cx(
          'absolute rounded-full bg-[radial-gradient(circle,rgba(0,255,127,0.18),rgba(255,214,10,0.11)_45%,rgba(0,0,0,0)_72%)] blur-md',
          config.glowClassName,
        )}
      />
      <div className="relative h-[54%] w-[56%] rounded-[12%] bg-[#063d2b] shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
        <div className="absolute left-1/2 top-0 h-full w-[18%] -translate-x-1/2 bg-[#ffd60a]" />
        <div className="absolute left-0 top-[22%] h-[18%] w-full bg-[#ffd60a]" />
        <div className="absolute left-1/2 top-[-27%] h-[36%] w-[64%] -translate-x-1/2 rounded-[50%] border-[6px] border-[#ffd60a]" />
      </div>
    </div>
  )
}

function createGiftMaterial(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
  const size = bounds.getSize(new THREE.Vector3())
  const bodyBounds = bounds.clone()
  const position = geometry.getAttribute('position')

  if (position) {
    bodyBounds.makeEmpty()
    const bodyCutoffY = bounds.min.y + size.y * 0.7
    const point = new THREE.Vector3()

    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index)
      if (point.y <= bodyCutoffY) {
        bodyBounds.expandByPoint(point)
      }
    }

    if (bodyBounds.isEmpty()) {
      bodyBounds.copy(bounds)
    }
  }
  const bodySize = bodyBounds.getSize(new THREE.Vector3())

  return new THREE.ShaderMaterial({
    uniforms: {
      boundsMin: { value: bounds.min.clone() },
      boundsSize: { value: size },
      bodyBoundsMin: { value: bodyBounds.min.clone() },
      bodyBoundsSize: { value: bodySize },
      boxColor: { value: new THREE.Color('#0f8d5b') },
      boxHighlight: { value: new THREE.Color('#35eda0') },
      ribbonColor: { value: new THREE.Color('#ffd60a') },
      ribbonShadow: { value: new THREE.Color('#c58a00') },
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vLocalNormal;

      void main() {
        vLocalPosition = position;
        vLocalNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 boundsMin;
      uniform vec3 boundsSize;
      uniform vec3 bodyBoundsMin;
      uniform vec3 bodyBoundsSize;
      uniform vec3 boxColor;
      uniform vec3 boxHighlight;
      uniform vec3 ribbonColor;
      uniform vec3 ribbonShadow;

      varying vec3 vLocalPosition;
      varying vec3 vLocalNormal;

      float band(float value, float center, float width, float feather) {
        return 1.0 - smoothstep(width, width + feather, abs(value - center));
      }

      void main() {
        vec3 normalizedPosition = clamp((vLocalPosition - boundsMin) / max(boundsSize, vec3(0.000001)), 0.0, 1.0);
        vec3 bodyPosition = clamp((vLocalPosition - bodyBoundsMin) / max(bodyBoundsSize, vec3(0.000001)), 0.0, 1.0);
        vec3 localNormal = normalize(vLocalNormal);
        float xBand = band(bodyPosition.x, 0.5, 0.064, 0.022);
        float zBand = band(bodyPosition.z, 0.5, 0.064, 0.022);
        float frontOrBack = smoothstep(0.26, 0.62, abs(localNormal.z));
        float sideFace = smoothstep(0.26, 0.62, abs(localNormal.x));
        float topFace = smoothstep(0.34, 0.72, localNormal.y);
        float bodyRibbon = max(xBand * frontOrBack, zBand * sideFace);
        float lidRibbon = max(xBand, zBand) * topFace;
        float bowRibbon = smoothstep(0.68, 0.84, normalizedPosition.y) * max(
          band(bodyPosition.x, 0.5, 0.24, 0.12),
          band(bodyPosition.z, 0.5, 0.24, 0.12)
        );
        float ribbonMask = clamp(max(max(bodyRibbon, lidRibbon), bowRibbon), 0.0, 1.0);

        float facing = max(dot(localNormal, normalize(vec3(-0.28, 0.72, 0.64))), 0.0);
        float heightLight = smoothstep(0.08, 0.95, normalizedPosition.y);
        float shade = clamp(0.84 + facing * 0.16 + heightLight * 0.10, 0.78, 1.0);

        vec3 packageColor = mix(boxColor, boxHighlight, clamp(facing * 0.28 + heightLight * 0.24, 0.0, 1.0));
        vec3 bowColor = mix(ribbonShadow, ribbonColor, shade);
        vec3 color = mix(packageColor * shade, bowColor, ribbonMask);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    toneMapped: false,
  })
}

function PresentScene({ size }: { size: GiftSize }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    let disposed = false
    let frame = 0
    const config = giftConfigs[size]
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    camera.position.set(0, config.cameraY, config.cameraZ)
    camera.lookAt(0, config.lookAtY, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      })
    } catch {
      setFailed(true)
      return undefined
    }
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    host.appendChild(renderer.domElement)

    const modelGroup = new THREE.Group()
    modelGroup.rotation.x = 0.02
    modelGroup.rotation.y = 0
    scene.add(modelGroup)

    const key = new THREE.DirectionalLight(0xffffff, 0.9)
    key.position.set(3, 4, 5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xb7ffd1, 0.45)
    fill.position.set(-4, 2, 3)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xfff0a3, 0.35)
    rim.position.set(-2, 3, -4)
    scene.add(rim)
    scene.add(new THREE.AmbientLight(0xffffff, 0.45))

    const resize = () => {
      if (disposed) return
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()

    new GLTFLoader().load(
      presentModelUrl,
      gltf => {
        if (disposed) return

        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        const dimensions = box.getSize(new THREE.Vector3())
        const largestDimension = Math.max(dimensions.x, dimensions.y, dimensions.z) || 1

        model.position.sub(center)
        model.position.y += config.yOffset
        model.scale.setScalar(config.targetSize / largestDimension)
        model.rotation.x = -0.02
        model.rotation.z = -0.02
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.material = createGiftMaterial(child.geometry)
            child.frustumCulled = false
          }
        })
        modelGroup.add(model)
      },
      undefined,
      () => {
        if (!disposed) setFailed(true)
      },
    )

    const clock = new THREE.Clock()
    const animate = () => {
      frame = requestAnimationFrame(animate)
      const elapsed = clock.getElapsedTime()
      modelGroup.rotation.y = elapsed * 0.72
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      modelGroup.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          materials.forEach(material => material.dispose())
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [size])

  if (failed) return <GiftFallback size={size} />

  return (
    <div className="relative h-full w-full">
      <div
        aria-hidden="true"
        className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(0,255,127,0.20),rgba(255,209,102,0.10)_42%,transparent_70%)] blur-lg"
      />
      <div ref={hostRef} className="relative h-full w-full" />
    </div>
  )
}

export function GiftModel({
  onClick,
  disabled = false,
  size = 'nav',
  interactive = true,
  className,
  title = 'Take our Survey!',
}: {
  onClick?: () => void
  disabled?: boolean
  size?: GiftSize
  interactive?: boolean
  className?: string
  title?: string
}) {
  const config = giftConfigs[size]
  const model = <PresentScene size={size} />

  if (!interactive) {
    return (
      <div
        aria-hidden="true"
        className={cx('relative flex-shrink-0 border-0 bg-transparent p-0', config.wrapperClassName, className)}
      >
        {model}
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label="Open research survey"
      className={cx(
        'no-drag relative z-50 block flex-shrink-0 border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        config.wrapperClassName,
        disabled ? 'cursor-wait opacity-50' : 'cursor-pointer',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation()
        if (disabled) return
        onClick?.()
      }}
      title={title ?? 'Open the optional product research survey. Shortcut: Enter'}
    >
      {model}
    </button>
  )
}
