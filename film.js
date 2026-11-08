// Motor de película. El MISMO shader se usa para la vista previa y para la foto final,
// así lo que ves en pantalla es exactamente lo que se guarda.

const LOOKS = {
  '800T Noche': {
    wb: [0.95, 1.0, 1.07], exposure: 1.05, flash: 0, contrast: 1.12,
    lift: [0.035, 0.055, 0.065], gain: [0.98, 0.96, 0.92],
    shadowTint: [-0.02, 0.012, 0.03], highTint: [0.045, 0.012, -0.035], sat: 0.95,
    halation: 1.3, halThresh: 0.8, halColor: [1.0, 0.12, 0.04], bloom: 0.35,
    grain: 0.07, grainSize: 900, vignette: 0.3
  },
  'Fuji 400': {
    wb: [1.02, 1.0, 0.95], exposure: 1.03, flash: 0, contrast: 1.05,
    lift: [0.05, 0.058, 0.045], gain: [0.97, 0.96, 0.90],
    shadowTint: [-0.018, 0.022, 0.004], highTint: [0.03, 0.016, -0.028], sat: 0.84,
    halation: 0.3, halThresh: 0.8, halColor: [1.0, 0.3, 0.1], bloom: 0.15,
    grain: 0.055, grainSize: 1000, vignette: 0.25
  },
  'Desechable flash': {
    wb: [1.0, 1.0, 1.03], exposure: 0.92, flash: 0.55, contrast: 1.22,
    lift: [0.03, 0.03, 0.036], gain: [0.98, 0.97, 0.95],
    shadowTint: [-0.005, 0.01, 0.02], highTint: [0.03, 0.02, 0.0], sat: 1.05,
    halation: 0.4, halThresh: 0.85, halColor: [1.0, 0.2, 0.08], bloom: 0.2,
    grain: 0.08, grainSize: 780, vignette: 0.5
  }
};

const FILM_VERT = `
attribute vec2 p;
varying vec2 uv;
uniform bool mirror;
void main(){
  uv = p*0.5+0.5; uv.y = 1.0-uv.y;
  if(mirror) uv.x = 1.0-uv.x;
  gl_Position = vec4(p,0.,1.);
}`;

const FILM_FRAG = `
precision highp float;
varying vec2 uv;
uniform sampler2D img;
uniform vec2 res;
uniform float seed, grain, grainSize;
uniform vec3 wb; uniform float exposure, flash, contrast;
uniform vec3 lift, gain, shadowTint, highTint; uniform float sat;
uniform float halation, halThresh, bloom; uniform vec3 halColor;
uniform float vignette, leak, leakSeed;

float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float luma(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
vec3 base(vec2 t){ return texture2D(img,t).rgb*wb*exposure; }

void main(){
  vec2 asp = vec2(res.y/res.x,1.0);
  vec2 d = uv-0.5; d.x *= res.x/res.y; float r = length(d);
  vec3 c = base(uv);

  // Flash directo simulado: centro quemado que cae hacia los bordes
  c *= 1.0 + flash*(1.1*(1.0-smoothstep(0.0,0.75,r)) - 0.35*smoothstep(0.4,1.0,r));

  // Halation (halo rojo alrededor de luces) + bloom
  if(halation+bloom > 0.0){
    vec3 acc = vec3(0.0); float hal = 0.0;
    for(int i=0;i<12;i++){
      float a = float(i)*0.5236 + 0.26;
      vec2 dir = vec2(cos(a),sin(a))*asp;
      for(int k=1;k<=2;k++){
        vec3 s = base(uv + dir*0.007*float(k*k));
        float h = max(max(s.r,max(s.g,s.b))-halThresh,0.0)/(1.0-halThresh);
        hal += h; acc += s*h;
      }
    }
    hal /= 24.0; acc /= 24.0;
    c += halColor*hal*halation + acc*bloom;
  }

  // Curva de película
  c = clamp(c,0.0,1.2);
  vec3 sc = c*c*(3.0-2.0*clamp(c,0.,1.));
  c = mix(c, sc, clamp(contrast-1.0,0.0,1.0)*2.5);
  c = lift + c*(gain-lift);

  // Separación de color: sombras / luces
  float l = luma(c);
  c += shadowTint*(1.0-l) + highTint*l;
  c = mix(vec3(luma(c)), c, sat);

  // Fuga de luz (posición fija por semilla, igual en vista previa y foto)
  if(leak > 0.0){
    float side = hash(vec2(leakSeed,1.3)) > 0.5 ? 1.08 : -0.08;
    vec2 lp = vec2(side, 0.15+0.7*hash(vec2(leakSeed,7.1)));
    vec2 q = (uv-lp); q.x *= res.x/res.y;
    float g = exp(-dot(q,q)*6.0);
    vec3 lc = mix(vec3(0.9,0.2,0.05), vec3(1.0,0.75,0.3), exp(-dot(q,q)*25.0));
    c = 1.0-(1.0-c)*(1.0-clamp(lc*g*leak,0.0,1.0));
  }

  // Viñeta
  c *= 1.0 - vignette*smoothstep(0.3,1.0,r);

  // Grano relativo al tamaño de la imagen
  if(grain > 0.0){
    vec2 gc = floor(uv*vec2(res.x/res.y,1.0)*grainSize);
    float n = hash(gc+seed) + hash(gc*1.7+seed*3.1) - 1.0;
    l = luma(c);
    c += n*grain*(0.5+1.6*l*(1.0-l));
  }
  gl_FragColor = vec4(clamp(c,0.,1.),1.);
}`;

const FILM_UNIFORMS = ['img','res','seed','grain','grainSize','wb','exposure','flash','contrast','lift','gain',
  'shadowTint','highTint','sat','halation','halThresh','bloom','halColor','vignette','leak','leakSeed','mirror'];

class FilmRenderer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: !!opts.preserve, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL no disponible');
    this.gl = gl; this.canvas = canvas;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, FILM_VERT));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FILM_FRAG));
    gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.u = {}; for (const n of FILM_UNIFORMS) this.u[n] = gl.getUniformLocation(pr, n);
  }
  // o = { look, grainOn, leakOn, leakSeed, seed, mirror }
  draw(source, w, h, o) {
    const gl = this.gl, u = this.u, L = LOOKS[o.look];
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.uniform2f(u.res, w, h);
    gl.uniform1f(u.seed, o.seed || 0);
    gl.uniform1i(u.mirror, o.mirror ? 1 : 0);
    gl.uniform1f(u.grain, o.grainOn ? L.grain : 0);
    gl.uniform1f(u.leak, o.leakOn ? 0.85 : 0);
    gl.uniform1f(u.leakSeed, o.leakSeed || 0);
    for (const k of ['wb','lift','gain','shadowTint','highTint','halColor']) gl.uniform3fv(u[k], L[k]);
    for (const k of ['grainSize','exposure','flash','contrast','sat','halation','halThresh','bloom','vignette']) gl.uniform1f(u[k], L[k]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

// Fecha estampada estilo cámara desechable. Se dibuja igual en la vista previa y en la foto.
function drawDateStamp(ctx, w, h, date = new Date()) {
  const yy = String(date.getFullYear()).slice(2), mm = String(date.getMonth() + 1).padStart(2, '0'), dd = String(date.getDate()).padStart(2, '0');
  const text = `'${yy}  ${mm}  ${dd}`;
  const size = Math.round(Math.min(w, h) * 0.045);
  ctx.save();
  ctx.font = `bold ${size}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ff8c2a';
  ctx.shadowColor = 'rgba(255,90,20,0.9)'; ctx.shadowBlur = size * 0.35;
  ctx.globalAlpha = 0.92;
  ctx.fillText(text, w - size * 1.6, h - size * 1.3);
  ctx.restore();
}

const FRAMES = { 'Sin marco': null, 'Marco blanco': '#f4f1ea', 'Marco negro': '#0b0b0b' };
const FRAME_FRAC = 0.04; // grosor del marco relativo al lado corto
