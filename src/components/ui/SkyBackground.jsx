import React, { useRef, useEffect } from 'react';
import { hexToRgb } from '@/lib/utils';

/**
 * Sky Background — Clouds + shooting stars WebGL2 shader.
 * @param {{ color?: string }} props - Hex accent color (default: "#f59e0b")
 */
export function SkyBackground({ color = "#f59e0b" }) {
    const canvasRef = useRef(null);
    const rendererRef = useRef(null);
    const animationFrameRef = useRef(null);
    const colorRef = useRef(hexToRgb(color));

    useEffect(() => {
        colorRef.current = hexToRgb(color);
    }, [color]);

    const shaderSource = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 resolution;
uniform float time;
uniform vec3 uAccent;
#define FC gl_FragCoord.xy
#define T time
#define R resolution
#define MN min(R.x,R.y)

float rnd(vec2 p) {
  p=fract(p*vec2(12.9898,78.233));
  p+=dot(p,p+34.56);
  return fract(p.x*p.y);
}

float noise(in vec2 p) {
  vec2 i=floor(p), f=fract(p), u=f*f*(3.-2.*f);
  float
  a=rnd(i),
  b=rnd(i+vec2(1,0)),
  c=rnd(i+vec2(0,1)),
  d=rnd(i+1.);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}

float fbm(vec2 p) {
  float t=.0, a=1.; mat2 m=mat2(1.,-.5,.2,1.2);
  for (int i=0; i<5; i++) {
    t+=a*noise(p);
    p*=2.*m;
    a*=.5;
  }
  return t;
}

float clouds(vec2 p) {
  float d=1., t=.0;
  for (float i=.0; i<3.; i++) {
    float a=d*fbm(i*10.+p.x*.2+.2*(1.+i)*p.y+d+i*i+p);
    t=mix(t,d,a);
    d=a;
    p*=2./(i+1.);
  }
  return t;
}

void main(void) {
  vec2 uv=(FC-.5*R)/MN, st=uv*vec2(2,1);
  vec3 col=vec3(0);
  float bg=clouds(vec2(st.x+T*.5,-st.y));
  uv*=1.-.3*(sin(T*.2)*.5+.5);
  for (float i=1.; i<12.; i++) {
    uv+=.1*cos(i*vec2(.1+.01*i, .8)+i*i+T*.5+.1*uv.x);
    vec2 p=uv;
    float d=length(p);
    // Shooting stars tinted by accent
    col+=.00125/d*(uAccent*2.0+0.5);
    float b=noise(i+p+bg*1.731);
    col+=.002*b/length(max(p,vec2(b*p.x*.02,p.y)));
    // Clouds tinted by accent
    col=mix(col, vec3(bg*uAccent.r*0.5, bg*uAccent.g*0.3, bg*uAccent.b*0.1), d);
  }
  O=vec4(col,1);
}`;

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const gl = canvas.getContext('webgl2');
        if (!gl) { console.warn('WebGL2 not supported.'); return; }

        // Compile shaders
        const vertSrc = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vertSrc);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, shaderSource);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error('Sky shader error:', gl.getShaderInfoLog(fs));
        }

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const resLoc = gl.getUniformLocation(program, 'resolution');
        const timeLoc = gl.getUniformLocation(program, 'time');
        const accentLoc = gl.getUniformLocation(program, 'uAccent');

        rendererRef.current = { gl, program, buffer, resLoc, timeLoc, accentLoc, vs, fs };

        const dpr = Math.max(1, 0.5 * window.devicePixelRatio);
        const resize = () => {
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
        };
        resize();
        window.addEventListener('resize', resize);

        const loop = (now) => {
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.uniform2f(resLoc, canvas.width, canvas.height);
            gl.uniform1f(timeLoc, now * 1e-3);
            // Pass accent color from ref
            const c = colorRef.current;
            gl.uniform3f(accentLoc, c[0], c[1], c[2]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            animationFrameRef.current = requestAnimationFrame(loop);
        };
        loop(0);

        return () => {
            window.removeEventListener('resize', resize);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            gl.deleteProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            gl.deleteBuffer(buffer);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-contain"
            style={{ background: 'black' }}
        />
    );
}

export default SkyBackground;
