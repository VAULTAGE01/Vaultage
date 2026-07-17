import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AnimatedGradientProps {
  className?: string
  variant?: 'vortex'
  palette?: 'green' | 'darkGrey'
  speed?: number
  opacity?: number
  children?: ReactNode
}

const PALETTES = {
  green: {
    containerBg: '#020806',
    background: [0.003, 0.020, 0.013],
    depth: [0.000, 0.090, 0.050],
    line: [0.120, 0.820, 0.430],
    glow: [0.500, 1.000, 0.720],
  },
  darkGrey: {
    containerBg: '#020806',
    background: [0.003, 0.020, 0.013],
    depth: [0.035, 0.048, 0.043],
    line: [0.600, 0.660, 0.620],
    glow: [0.880, 0.910, 0.875],
  },
} as const

const VERTEX_SHADER = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const VORTEX_SHADER = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec3 u_bg_color;
  uniform vec3 u_depth_color;
  uniform vec3 u_line_color;
  uniform vec3 u_glow_color;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 2; ++i) {
      v += a * noise(p);
      p = rot * p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = v_uv;
    float aspect = u_resolution.x / u_resolution.y;
    float t = u_time * 0.55;

    vec2 center = vec2(0.5);
    vec2 st = uv - center;
    st.x *= aspect;

    float dist = length(st);
    float angle = atan(st.y, st.x);

    float swirl = 3.2 / (dist + 0.3);
    angle += swirl * 0.6 * smoothstep(0.04, 0.25, dist) + t * 0.3;

    float rippleMask = smoothstep(0.08, 0.35, dist);
    dist += sin(angle * 2.0 - t * 1.2) * 0.015 * rippleMask * (1.0 - smoothstep(0.0, 0.9, dist));

    vec2 twisted = vec2(cos(angle), sin(angle)) * dist;
    twisted.x /= aspect;
    twisted += center;

    vec2 flowCoord = twisted * 1.5;
    vec2 q = vec2(
      fbm(flowCoord - t * 0.04),
      fbm(flowCoord + vec2(5.2, 1.3) + t * 0.02)
    );

    vec2 r = flowCoord + q * 0.35;
    float f = fbm(r);
    float contour = sin(f * 18.0 - t * 1.2);

    vec3 bgColor = u_bg_color;
    vec3 depthColor = u_depth_color;
    vec3 lineColor = u_line_color;
    vec3 glowColor = u_glow_color;

    float line = smoothstep(0.960, 0.986, abs(contour));
    float centerGlow = 1.0 - smoothstep(0.0, 0.62, dist);
    float mist = smoothstep(0.24, 0.82, f) * centerGlow;

    vec3 col = mix(bgColor, depthColor, mist * 0.42);
    col = mix(col, lineColor, line * 0.72);
    col += glowColor * centerGlow * 0.055;
    col += lineColor * line * centerGlow * 0.12;

    gl_FragColor = vec4(col, 1.0);
  }
`

export function AnimatedGradient({
  className,
  variant = 'vortex',
  palette = 'green',
  speed = 1,
  opacity = 1,
  children,
}: AnimatedGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) return

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    resize()
    window.addEventListener('resize', resize)

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vertexShader = createShader(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, VORTEX_SHADER)

    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader)
      if (fragmentShader) gl.deleteShader(fragmentShader)
      return
    }

    const program = gl.createProgram()
    if (!program) {
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      return
    }

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program))
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      gl.deleteProgram(program)
      return
    }

    gl.useProgram(program)

    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    const timeLocation = gl.getUniformLocation(program, 'u_time')
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const bgColorLocation = gl.getUniformLocation(program, 'u_bg_color')
    const depthColorLocation = gl.getUniformLocation(program, 'u_depth_color')
    const lineColorLocation = gl.getUniformLocation(program, 'u_line_color')
    const glowColorLocation = gl.getUniformLocation(program, 'u_glow_color')
    const colors = PALETTES[palette]
    gl.uniform3fv(bgColorLocation, new Float32Array(colors.background))
    gl.uniform3fv(depthColorLocation, new Float32Array(colors.depth))
    gl.uniform3fv(lineColorLocation, new Float32Array(colors.line))
    gl.uniform3fv(glowColorLocation, new Float32Array(colors.glow))
    const startTime = Date.now()

    let isVisible = true
    let isRendering = false

    const render = () => {
      if (!isVisible) {
        isRendering = false
        return
      }

      const elapsed = prefersReducedMotion ? 0 : (Date.now() - startTime) / 1000
      gl.uniform1f(timeLocation, elapsed * speed)
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (prefersReducedMotion) {
        isRendering = false
        return
      }

      animationRef.current = requestAnimationFrame(render)
    }

    const startRendering = () => {
      if (isRendering) return
      isRendering = true
      render()
    }

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              isVisible = entry.isIntersecting
              if (isVisible) {
                startRendering()
              } else {
                if (animationRef.current) cancelAnimationFrame(animationRef.current)
                animationRef.current = 0
                isRendering = false
              }
            },
            { rootMargin: '120px 0px' },
          )

    observer?.observe(canvas)
    startRendering()

    return () => {
      window.removeEventListener('resize', resize)
      observer?.disconnect()
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      gl.deleteProgram(program)
      gl.deleteBuffer(buffer)
    }
  }, [variant, palette, speed])

  return (
    <div className={cn('relative overflow-hidden', className)} style={{ backgroundColor: PALETTES[palette].containerBg }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ opacity }} />
      {children && <div className="relative z-10 h-full w-full">{children}</div>}
    </div>
  )
}
