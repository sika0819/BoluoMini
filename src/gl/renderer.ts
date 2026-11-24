import type { Host } from '../host/types'
import { stageFit } from '../ui/fit'
import { identity, lookAt, multiply, perspective } from './math'
import { FORWARD_FS, FORWARD_VS, SKY_FS, SKY_VS } from '../oil/shaders'
import { skyLook } from './sky'
import type { MeshData } from '../scene/world'

export type Tier = 'low' | 'mid' | 'high'

export interface DrawItem {
  mesh: MeshData
  model: Float32Array
}

export interface FrameState {
  eye: number[]
  target: number[]
  sun: number[]
  sunColor: number[]
  fogColor: number[]
  fogDensity: number
  shadeSteps: number
  time: number
  tier: Tier
  /** 0..1 rain amount. Drives sky darkening and which streaks are drawn. */
  rain: number
  /** 0..1 ground mist. The forward pass folds it into the existing fog. */
  mist: number
  /** Sheet-lightning pulse. Sky only; no bolt mesh. */
  flash: number
  /** Sway scale. Higher wind gears move plants farther. */
  wind: number
  /** 0 morning, 1 noon, 2 sunset, 3 night. Drives the sky gradient. */
  period: number
  /** 0..1 cumulus cover. */
  cover: number
  /** 0..1 hunt darkening. Scales sun, sky, and the ambient floor. */
  dim: number
  items: DrawItem[]
  outline: DrawItem[]
}

interface GpuMesh {
  vbo: WebGLBuffer
  ibo: WebGLBuffer
  count: number
}

interface Program {
  program: WebGLProgram
  attribs: Record<string, number>
  uniforms: Record<string, WebGLUniformLocation | null>
}

const STRIDE = 12 * 4

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'compile')
  }
  return shader
}

function link(gl: WebGLRenderingContext, vs: string, fs: string, attrs: string[]): Program {
  const program = gl.createProgram()
  if (!program) throw new Error('program')
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'link')
  }
  const attribs: Record<string, number> = {}
  for (const name of attrs) attribs[name] = gl.getAttribLocation(program, name)
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)
    if (!info) continue
    uniforms[info.name] = gl.getUniformLocation(program, info.name)
  }
  return { program, attribs, uniforms }
}

export class Renderer {
  readonly gl: WebGLRenderingContext
  private forward: Program
  private sky: Program
  private meshes = new Map<MeshData, GpuMesh>()
  private quad: WebGLBuffer
  private leaf: WebGLTexture
  private face: WebGLTexture
  private view = new Float32Array(16)
  private proj = new Float32Array(16)
  private viewProj = new Float32Array(16)
  private attribCount = 8
  readonly ready: boolean

  constructor(private host: Host) {
    const gl = host.screen.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    }) ?? host.screen.getContext('webgl')
    if (!gl) throw new Error('webgl')
    this.gl = gl
    this.attribCount = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number
    this.forward = link(gl, FORWARD_VS, FORWARD_FS, ['aPos', 'aNormal', 'aColor', 'aKind', 'aUv'])
    this.sky = link(gl, SKY_VS, SKY_FS, ['aPos'])
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.leaf = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.leaf)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    this.face = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.face)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.ready = true
  }

  private loadTex(target: WebGLTexture, url: string, mip = false, flipY = true): void {
    const g = globalThis as unknown as {
      Image?: new () => HTMLImageElement
      wx?: { createImage?: () => HTMLImageElement }
      tt?: { createImage?: () => HTMLImageElement }
      bl?: { createImage?: () => HTMLImageElement }
    }
    const img = g.wx?.createImage?.()
      ?? g.tt?.createImage?.()
      ?? g.bl?.createImage?.()
      ?? (typeof g.Image === 'function' ? new g.Image() : null)
    if (!img) return
    img.onload = () => {
      const gl = this.gl
      gl.bindTexture(gl.TEXTURE_2D, target)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      if (mip) gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    img.src = url
  }

  loadLeaf(url: string): void {
    this.loadTex(this.leaf, url)
  }

  /**
   * Eyes and mouth. Alpha is 0 on the rest of the body, which stays vertex color.
   * UVs are glTF top-left, so the upload is not flipped.
   */
  loadFace(url: string): void {
    this.loadTex(this.face, url, true, false)
  }

  /** Every tier draws the same direct pass. */
  compileTier(_tier: Tier): void {}

  private gpu(mesh: MeshData): GpuMesh {
    const cached = this.meshes.get(mesh)
    if (cached) {
      if (mesh.dynamic) {
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, cached.vbo)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.interleaved)
      }
      return cached
    }
    const gl = this.gl
    const vbo = gl.createBuffer()!
    const ibo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.interleaved, mesh.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
    const gpu = { vbo, ibo, count: mesh.indices.length }
    this.meshes.set(mesh, gpu)
    return gpu
  }

  drop(mesh: MeshData): void {
    const gpu = this.meshes.get(mesh)
    if (!gpu) return
    this.gl.deleteBuffer(gpu.vbo)
    this.gl.deleteBuffer(gpu.ibo)
    this.meshes.delete(mesh)
  }

  private bindMesh(program: Program, mesh: GpuMesh): void {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo)
    for (let i = 0; i < this.attribCount; i++) gl.disableVertexAttribArray(i)
    const bind = (name: string, size: number, offset: number) => {
      const loc = program.attribs[name]
      if (loc < 0) return
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset)
    }
    bind('aPos', 3, 0)
    bind('aNormal', 3, 12)
    bind('aColor', 3, 24)
    bind('aKind', 1, 36)
    bind('aUv', 2, 40)
  }

  draw(frame: FrameState, ui: { texture: WebGLTexture | null; alpha: number }): void {
    const gl = this.gl
    const canvas = this.host.screen
    const w = Math.max(2, canvas.width)
    const h = Math.max(2, canvas.height)
    lookAt(frame.eye, frame.target, [0, 1, 0], this.view)
    perspective(Math.PI / 3, w / h, 0.15, 2800, this.proj)
    multiply(this.proj, this.view, this.viewProj)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(frame.fogColor[0], frame.fogColor[1], frame.fogColor[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)

    this.drawSky(frame, w, h)
    this.drawShaded(frame, false)
    this.drawShaded(frame, true)
    gl.enable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.depthMask(true)

    if (ui.texture && ui.alpha > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.disable(gl.DEPTH_TEST)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      this.blitUi(ui.texture, ui.alpha)
      gl.disable(gl.BLEND)
    }
    gl.enable(gl.DEPTH_TEST)
  }

  private drawSky(frame: FrameState, w: number, h: number): void {
    const gl = this.gl
    const look = skyLook(frame.period)
    const v = this.view
    gl.depthMask(false)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.useProgram(this.sky.program)
    const u = this.sky.uniforms
    gl.uniform3f(u.uRight, v[0], v[4], v[8])
    gl.uniform3f(u.uUp, v[1], v[5], v[9])
    gl.uniform3f(u.uForward, -v[2], -v[6], -v[10])
    gl.uniform1f(u.uAspect, w / Math.max(1, h))
    gl.uniform1f(u.uTan, Math.tan(Math.PI / 6))
    gl.uniform3fv(u.uSunDir, frame.sun)
    gl.uniform1f(u.uNight, look.night)
    gl.uniform1f(u.uRain, frame.rain)
    gl.uniform1f(u.uTime, frame.time)
    gl.uniform1f(u.uWind, frame.wind)
    gl.uniform1f(u.uMist, frame.mist)
    gl.uniform1f(u.uFlash, frame.flash)
    const dusk = 1 - frame.dim * 0.78
    const shade = (v: number[]) => [v[0] * dusk, v[1] * dusk, v[2] * dusk]
    gl.uniform3fv(u.uZen, shade(look.zen))
    gl.uniform3fv(u.uMid, shade(look.mid))
    gl.uniform3fv(u.uLow, shade(look.low))
    gl.uniform3fv(u.uHor, shade(look.hor))
    gl.uniform3fv(u.uHorSun, shade(look.horSun))
    gl.uniform3fv(u.uDisc, shade(look.disc))
    gl.uniform3fv(u.uCloudLit, shade(look.cloudLit))
    gl.uniform3fv(u.uCloudMid, shade(look.cloudMid))
    gl.uniform3fv(u.uCloudSh, shade(look.cloudSh))
    gl.uniform1f(u.uCover, frame.cover)
    const loc = this.sky.attribs.aPos
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
  }

  private drawShaded(frame: FrameState, blended: boolean): void {
    const gl = this.gl
    const program = this.forward
    const u = program.uniforms
    gl.useProgram(program.program)
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj)
    gl.uniform3fv(u.uSunDir, frame.sun)
    gl.uniform3fv(u.uSunColor, frame.sunColor)
    gl.uniform3fv(u.uFogColor, frame.fogColor)
    gl.uniform1f(u.uFogDensity, frame.fogDensity)
    gl.uniform1f(u.uTime, frame.time)
    gl.uniform1f(u.uWind, frame.wind)
    gl.uniform1f(u.uRain, frame.rain)
    gl.uniform1f(u.uMist, frame.mist)
    gl.uniform3fv(u.uEye, frame.eye)
    gl.uniform1f(u.uDim, frame.dim)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.leaf)
    gl.uniform1i(u.uLeaf, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.face)
    if (u.uFace != null) gl.uniform1i(u.uFace, 1)
    gl.activeTexture(gl.TEXTURE0)
    if (blended) {
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
    } else {
      gl.disable(gl.BLEND)
      gl.depthMask(true)
    }
    for (const item of frame.items) {
      if (!!item.mesh.blended !== blended) continue
      const gpu = this.gpu(item.mesh)
      if (gpu.count < 3) continue
      this.bindMesh(program, gpu)
      if (item.mesh.doubleSided) gl.disable(gl.CULL_FACE)
      else gl.enable(gl.CULL_FACE)
      gl.uniformMatrix4fv(u.uModel, false, item.model)
      gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_SHORT, 0)
    }
  }

  private uiProgram: Program | null = null
  private uiQuad: WebGLBuffer | null = null

  private blitUi(texture: WebGLTexture, alpha: number): void {
    const gl = this.gl
    const canvas = this.host.screen
    if (canvas.width < 1 || canvas.height < 1) return
    if (!this.uiProgram) {
      this.uiProgram = link(gl, `
        attribute vec2 aPos;
        attribute vec2 aUv;
        varying vec2 vUv;
        void main() {
          vUv = aUv;
          gl_Position = vec4(aPos, 0.0, 1.0);
        }
      `, `
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D uColor;
        uniform float uAlpha;
        void main() {
          vec4 c = texture2D(uColor, vec2(vUv.x, 1.0 - vUv.y));
          gl_FragColor = vec4(c.rgb, c.a * uAlpha);
        }
      `, ['aPos', 'aUv'])
      this.uiQuad = gl.createBuffer()
    }
    const fit = stageFit(canvas.width, canvas.height)
    const x0 = fit.x / canvas.width * 2 - 1
    const x1 = (fit.x + fit.width) / canvas.width * 2 - 1
    const y0 = 1 - (fit.y + fit.height) / canvas.height * 2
    const y1 = 1 - fit.y / canvas.height * 2
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uiQuad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      x0, y0, 0, 0,
      x1, y0, 1, 0,
      x0, y1, 0, 1,
      x1, y1, 1, 1,
    ]), gl.DYNAMIC_DRAW)
    gl.useProgram(this.uiProgram.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(this.uiProgram.uniforms.uColor, 0)
    gl.uniform1f(this.uiProgram.uniforms.uAlpha, alpha)
    const stride = 16
    const pos = this.uiProgram.attribs.aPos
    const uv = this.uiProgram.attribs.aUv
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(uv)
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 8)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  uploadUi(canvas: Host['screen']): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas as unknown as TexImageSource)
    return tex
  }

  updateUi(tex: WebGLTexture, canvas: Host['screen']): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas as unknown as TexImageSource)
  }
}

export function modelAt(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16)
  identity(m)
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}
