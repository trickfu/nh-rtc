import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

const Particles = ({ audioStream }) => {
    const count = 1500;
    const mesh = useRef();
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Audio analysis refs
    const analyser = useRef();
    const dataArray = useRef();
    const audioContext = useRef();

    useEffect(() => {
        if (audioStream) {
            if (!audioContext.current) {
                audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
            }

            if (audioContext.current.state === 'suspended') {
                audioContext.current.resume();
            }

            const source = audioContext.current.createMediaStreamSource(audioStream);
            analyser.current = audioContext.current.createAnalyser();
            analyser.current.fftSize = 128; // Increased for better resolution
            source.connect(analyser.current);
            dataArray.current = new Uint8Array(analyser.current.frequencyBinCount);

            return () => {
                // Don't close context immediately to allow reuse or graceful shutdown if needed, 
                // but typically you'd disconnect.
                source.disconnect();
            };
        } else {
            analyser.current = null;
        }
    }, [audioStream]);

    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < count; i++) {
            const t = Math.random() * 100;
            const factor = 20 + Math.random() * 100;
            const speed = 0.01 + Math.random() / 200;
            const xFactor = -50 + Math.random() * 100;
            const yFactor = -50 + Math.random() * 100;
            const zFactor = -50 + Math.random() * 100;

            // Emission properties
            const isEmitting = false;
            const emissionVelocity = new THREE.Vector3();

            temp.push({
                t, factor, speed, xFactor, yFactor, zFactor, mx: 0, my: 0,
                isEmitting, emissionVelocity
            });
        }
        return temp;
    }, [count]);

    // Colors: Purple and Blue mix
    const colorArray = useMemo(() => {
        const colors = new Float32Array(count * 3);
        const c1 = new THREE.Color('#a855f7'); // Purple-500
        const c2 = new THREE.Color('#3b82f6'); // Blue-500

        for (let i = 0; i < count; i++) {
            // Mix with some randomness
            const ratio = Math.random();
            const color = new THREE.Color().lerpColors(c1, c2, ratio);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        return colors;
    }, [count]);

    useFrame((state) => {
        if (!mesh.current) return;

        let audioValue = 0;
        if (analyser.current && dataArray.current) {
            analyser.current.getByteFrequencyData(dataArray.current);
            // Calculate average volume
            const sum = dataArray.current.reduce((a, b) => a + b, 0);
            audioValue = sum / dataArray.current.length;
        }

        const intensity = audioValue / 255;
        const time = state.clock.getElapsedTime();

        // Color definitions
        const tempColor = new THREE.Color();
        const baseColor1 = new THREE.Color('#a855f7'); // Purple
        const baseColor2 = new THREE.Color('#3b82f6'); // Blue
        const waveColor1 = new THREE.Color('#00ffff'); // Cyan
        const waveColor2 = new THREE.Color('#ff00ff'); // Magenta
        const white = new THREE.Color('#ffffff');

        particles.forEach((particle, i) => {
            let { t, factor, speed, xFactor, yFactor, zFactor } = particle;

            // Update time for particle (slower base movement)
            particle.t += speed / 3;
            const tMoved = particle.t;

            const a = Math.cos(tMoved) + Math.sin(tMoved * 1) / 10;
            const b = Math.sin(tMoved) + Math.cos(tMoved * 2) / 10;
            const s = Math.cos(tMoved);

            // Default: Resting state (floating chaotic field)
            let targetX = (particle.mx / 10) * a + xFactor + Math.cos((tMoved / 10) * factor) + (Math.sin(tMoved * 1) * factor) / 10;
            let targetY = (particle.my / 10) * b + yFactor + Math.sin((tMoved / 10) * factor) + (Math.cos(tMoved * 2) * factor) / 10;
            let targetZ = (particle.my / 10) * b + zFactor + Math.cos((tMoved / 10) * factor) + (Math.sin(tMoved * 3) * factor) / 10;

            // Current position persistence
            if (particle.curX === undefined) {
                particle.curX = targetX; particle.curY = targetY; particle.curZ = targetZ;
            }

            if (audioStream) {
                // Audio Active Logic

                // Define 3 Layers
                // Layer 0: Base Ring (Stable)
                // Layer 1: Wave Ring 1 (Mid distortion)
                // Layer 2: Wave Ring 2 (High distortion)
                const layer = i % 3;

                const angle = (i / count) * Math.PI * 2 + time * 0.1;
                const baseRadius = 12;

                if (layer === 0) {
                    // --- Base Ring: Constant Shape ---
                    const r = baseRadius;
                    const ringX = Math.cos(angle) * r;
                    const ringY = Math.sin(angle) * r;
                    const ringZ = 0; // Flat

                    // Updates
                    targetX = ringX;
                    targetY = ringY;
                    targetZ = ringZ;

                    // Color: Stable Gradient
                    const ratio = (Math.sin(angle + time) + 1) / 2;
                    tempColor.lerpColors(baseColor1, baseColor2, ratio);
                    mesh.current.setColorAt(i, tempColor);

                } else if (layer === 1) {
                    // --- Wave Ring 1: Medium Distortion (Cyan theme) ---
                    // Gently floats on top
                    const w1 = Math.sin(angle * 5 + time * 3) * (intensity * 4);
                    const r = baseRadius + w1;

                    const ringX = Math.cos(angle) * r;
                    const ringY = Math.sin(angle) * r;
                    const ringZ = Math.cos(angle * 3 + time) * 2; // Slight depth

                    targetX = ringX;
                    targetY = ringY;
                    targetZ = ringZ;

                    // Color: Cyan mix
                    tempColor.lerpColors(baseColor2, waveColor1, intensity + 0.3);
                    mesh.current.setColorAt(i, tempColor);

                } else {
                    // --- Wave Ring 2: High Distortion (Magenta theme) ---
                    // Spiky, erratic
                    const w2 = Math.cos(angle * 10 - time * 5) * (intensity * 8);
                    const breathe = Math.sin(time * 5) * (intensity * 2);
                    const r = baseRadius + w2 + breathe;

                    const ringX = Math.cos(angle) * r;
                    const ringY = Math.sin(angle) * r;
                    const ringZ = Math.sin(angle * 8 + time * 2) * (intensity * 5); // More depth

                    targetX = ringX;
                    targetY = ringY;
                    targetZ = ringZ;

                    // Color: Magenta/White hot
                    const spike = Math.abs(w2) / (1 + intensity * 8);
                    if (intensity > 0.1 && spike > 0.5) {
                        tempColor.lerpColors(waveColor2, white, spike);
                    } else {
                        tempColor.lerpColors(baseColor1, waveColor2, intensity);
                    }
                    mesh.current.setColorAt(i, tempColor);
                }

                // Lerp current to target for smoothness
                const lerpFactor = 0.1;
                particle.curX = THREE.MathUtils.lerp(particle.curX, targetX, lerpFactor);
                particle.curY = THREE.MathUtils.lerp(particle.curY, targetY, lerpFactor);
                particle.curZ = THREE.MathUtils.lerp(particle.curZ, targetZ, lerpFactor);

                // Update persistent
                targetX = particle.curX;
                targetY = particle.curY;
                targetZ = particle.curZ;

            } else {
                // No Audio: Lerp back to chaotic field
                const lerpFactor = 0.02;
                particle.curX = THREE.MathUtils.lerp(particle.curX, targetX, lerpFactor);
                particle.curY = THREE.MathUtils.lerp(particle.curY, targetY, lerpFactor);
                particle.curZ = THREE.MathUtils.lerp(particle.curZ, targetZ, lerpFactor);

                targetX = particle.curX;
                targetY = particle.curY;
                targetZ = particle.curZ;

                // Reset colors to default gradient
                const ratio = (Math.sin(i + time) + 1) / 2;
                tempColor.lerpColors(baseColor1, baseColor2, ratio);
                mesh.current.setColorAt(i, tempColor);
            }

            dummy.position.set(targetX, targetY, targetZ);

            // Scale based on audio
            const baseScale = 0.15;
            // Diff layers get diff scales?
            let scaleAdd = intensity * 0.8;
            if (audioStream && i % 3 === 0) scaleAdd = 0; // Base ring stays small/stable

            dummy.scale.setScalar(baseScale + scaleAdd);

            dummy.rotation.set(s * 5, s * 5, s * 5);
            dummy.updateMatrix();

            mesh.current.setMatrixAt(i, dummy.matrix);
        });

        mesh.current.instanceMatrix.needsUpdate = true;
        // Always update color since we are continuously animating it in audio mode
        // and resetting it in silent mode
        mesh.current.instanceColor.needsUpdate = true;
    });

    return (
        <instancedMesh ref={mesh} args={[null, null, count]}>
            <sphereGeometry args={[1, 16, 16]}>
                <instancedBufferAttribute attach="attributes-color" args={[colorArray, 3]} />
            </sphereGeometry>
            <meshBasicMaterial vertexColors toneMapped={false} />
        </instancedMesh>
    );
};

export const BackgroundAlt = ({ audioStream }) => {
    return (
        <div className="w-full h-full bg-black/0"> {/* Transparent background */}
            <Canvas camera={{ position: [0, 0, 40], fov: 50 }} gl={{ alpha: true, antialias: true }}>
                <Particles audioStream={audioStream} />
                <EffectComposer>
                    <Bloom luminanceThreshold={0.1} luminanceSmoothing={0.9} height={300} intensity={1.5} radius={0.8} />
                </EffectComposer>
            </Canvas>
        </div>
    );
};
