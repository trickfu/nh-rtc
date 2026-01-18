import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

const Particles = ({ audioStream, inputMode }) => {
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
                isEmitting, emissionVelocity,
                life: 0, decayRate: 0.015, vx: 0, vy: 0, vz: 0
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

    // Generate Glow Texture
    const texture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 32, 32);
        return new THREE.CanvasTexture(canvas);
    }, []);

    useFrame((state) => {
        if (!mesh.current) return;

        let audioValue = 0;
        if (analyser.current && dataArray.current) {
            analyser.current.getByteFrequencyData(dataArray.current);
            // Calculate average volume
            const sum = dataArray.current.reduce((a, b) => a + b, 0);
            audioValue = sum / dataArray.current.length;
        }

        const time = state.clock.getElapsedTime();
        let intensity = 0;

        if (audioStream) {
            intensity = audioValue / 255;
        } else if (inputMode === 'text') {
            // Simulated gentle breathing for text mode
            // Sine wave from 0.05 to 0.25
            intensity = 0.15 + Math.sin(time * 3) * 0.1;
        }

        const active = !!audioStream || inputMode === 'text';

        // Color definitions
        const tempColor = new THREE.Color();
        const baseColor1 = new THREE.Color('#a855f7'); // Purple
        const baseColor2 = new THREE.Color('#3b82f6'); // Blue
        const waveColor1 = new THREE.Color('#00ffff'); // Cyan
        const waveColor2 = new THREE.Color('#ff00ff'); // Magenta
        const white = new THREE.Color('#ffffff');

        // Complex wave functions for randomness
        // Complex wave functions for randomness
        const getWave1 = (angle) => {
            // Smoother waves, lower frequencies
            return Math.sin(angle * 3 + time * 0.5) + Math.sin(angle * 5 - time * 1.5) * 0.5;
        };
        const getWave2 = (angle) => {
            // Smoother waves, removed high freq spike
            return Math.cos(angle * 4 + time * 4) + Math.sin(angle * 7 + time) * 0.5 + Math.cos(angle * 13 - time * 2) * 0.2;
        };

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

            if (active) {
                // Audio Active Logic

                // Define 4 Layers
                // Layer 0: Base Ring (Stable)
                // Layer 1: Wave Ring 1 (Mid distortion)
                // Layer 2: Wave Ring 2 (High distortion)
                // Layer 3: Emission Particles (Explosive)
                const layer = i % 4;

                const angle = (i / count) * Math.PI * 2 + time * 0.1;
                const baseRadius = 12;

                if (layer === 0) {
                    // --- Base Ring: Constant Shape ---
                    const r = baseRadius;
                    const ringX = Math.cos(angle) * r;
                    const ringY = Math.sin(angle) * r;
                    const ringZ = 0; // Flat

                    targetX = ringX;
                    targetY = ringY;
                    targetZ = ringZ;

                    // Color: Stable Gradient
                    const ratio = (Math.sin(angle + time) + 1) / 2;
                    tempColor.lerpColors(baseColor1, baseColor2, ratio);

                } else if (layer === 1) {
                    // --- Wave Ring 1: Medium Distortion (Cyan theme) ---
                    // Reduced multiplier for smoother look
                    const w1 = getWave1(angle) * (intensity * 4);
                    const breathe = Math.cos(time * 3) * (intensity * 2);
                    const r = baseRadius + w1 + breathe;

                    const ringX = Math.cos(angle) * r;
                    const ringY = Math.sin(angle) * r;
                    const ringZ = Math.cos(angle * 3 + time) * 2;

                    targetX = ringX;
                    targetY = ringY;
                    targetZ = ringZ;

                    tempColor.lerpColors(baseColor2, waveColor1, intensity + 0.3);

                } else if (layer === 2) {
                    // --- Wave Ring 2: High Distortion (Magenta theme) ---
                    // Reduced multiplier
                    const w2 = getWave2(angle) * (intensity * 5); // Kept similar but wave itself is smoother
                    const breathe = Math.sin(time * 5) * (intensity * 2);
                    const r = baseRadius + w2 + breathe;

                    const ringX = Math.cos(angle) * r;
                    const ringY = Math.sin(angle) * r;
                    const ringZ = Math.sin(angle * 8 + time * 2) * (intensity * 5);

                    targetX = ringX;
                    targetY = ringY;
                    targetZ = ringZ;

                    const spike = Math.abs(w2) / (1 + intensity * 8);
                    if (intensity > 0.1 && spike > 0.5) {
                        tempColor.lerpColors(waveColor2, white, spike);
                    } else {
                        tempColor.lerpColors(baseColor1, waveColor2, intensity);
                    }
                } else {
                    // --- Layer 3: Emitters ---
                    if (particle.life > 0) {
                        // Move particle
                        particle.curX += particle.vx;
                        particle.curY += particle.vy;
                        particle.curZ += particle.vz;
                        particle.life -= particle.decayRate; // Variable decay

                        targetX = particle.curX;
                        targetY = particle.curY;
                        targetZ = particle.curZ;

                        // Color fades to white/blue
                        tempColor.lerpColors(waveColor1, white, particle.life);

                    } else {
                        // Check if we should spawn
                        // Reduced global multiplier from 0.8 to 0.6 to lower count slightly
                        if (intensity > 0.05 && Math.random() < intensity * 0.6) {
                            particle.life = 1.0;
                            particle.decayRate = 0.01 + Math.random() * 0.03; // Randomize lifespan

                            // Randomly choose Source Ring (1 or 2)
                            const useRing1 = Math.random() > 0.5;
                            const spawnAngle = Math.random() * Math.PI * 2;

                            // Select wave function and properties based on ring
                            let rawWave, w, r, z;

                            if (useRing1) {
                                rawWave = getWave1(spawnAngle);
                                w = rawWave * (intensity * 4);
                                const breathe = Math.cos(time * 3) * (intensity * 2);
                                r = baseRadius + w + breathe;
                                z = Math.cos(spawnAngle * 3 + time) * 2; // Match Ring 1 Z

                                // Cyan/Blueish tint for these particles
                                tempColor.lerpColors(baseColor2, waveColor1, 0.8);
                            } else {
                                rawWave = getWave2(spawnAngle);
                                w = rawWave * (intensity * 5);
                                const breathe = Math.sin(time * 5) * (intensity * 2);
                                r = baseRadius + w + breathe;
                                z = Math.sin(spawnAngle * 8 + time * 2) * (intensity * 5); // Match Ring 2 Z

                                // Magenta/White tint
                                tempColor.set(white);
                            }

                            // Density Probability Check
                            const densityProb = (rawWave + 3) / 6;

                            if (Math.random() < densityProb) {
                                particle.curX = Math.cos(spawnAngle) * r;
                                particle.curY = Math.sin(spawnAngle) * r;
                                particle.curZ = z;

                                // Velocity outward from center
                                const speed = 0.05 + Math.random() * 0.1 * (intensity * 4);
                                particle.vx = Math.cos(spawnAngle) * speed;
                                particle.vy = Math.sin(spawnAngle) * speed;
                                particle.vz = (Math.random() - 0.5) * speed;

                                targetX = particle.curX;
                                targetY = particle.curY;
                                targetZ = particle.curZ;

                                // Color is already set in tempColor above for the spawn frame
                            } else {
                                targetX = 10000;
                            }
                        } else {
                            targetX = 10000;
                        }
                    }
                }

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
            }

            // Lerp current to target for smoothness
            const lerpFactor = 0.1;
            particle.curX = THREE.MathUtils.lerp(particle.curX, targetX, lerpFactor);
            particle.curY = THREE.MathUtils.lerp(particle.curY, targetY, lerpFactor);
            particle.curZ = THREE.MathUtils.lerp(particle.curZ, targetZ, lerpFactor);

            // Boost color for glow
            // Brighter particles when active to match reference image
            const boost = active ? 3.0 : 1.2;
            tempColor.multiplyScalar(boost);
            mesh.current.setColorAt(i, tempColor);

            dummy.position.set(particle.curX, particle.curY, particle.curZ);

            // Scale based on audio
            const baseScale = 0.3; // Increased base scale for glow sprites
            let scaleAdd = intensity * 1.5;

            if (active) {
                if (i % 4 === 0) scaleAdd = 0; // Base ring stays small/stable
                if (i % 4 === 3) {
                    // Emitter scale logic
                    if (particle.life > 0) {
                        scaleAdd = particle.life * 0.5; // Scale down with life
                    } else {
                        scaleAdd = -100; // Force scale to 0 (effectively)
                        // A negative scale here combined with baseScale might not check out if baseScale is small
                        // Better to set direct scalar
                    }
                }
            }

            let finalScale = baseScale + scaleAdd;
            if (active && i % 4 === 3 && particle.life <= 0) finalScale = 0;

            dummy.scale.setScalar(finalScale);

            // Billboarding: Face camera
            dummy.quaternion.copy(state.camera.quaternion);
            dummy.updateMatrix();

            mesh.current.setMatrixAt(i, dummy.matrix);
        });

        mesh.current.instanceMatrix.needsUpdate = true;
        mesh.current.instanceColor.needsUpdate = true;
    });

    return (
        <instancedMesh ref={mesh} args={[null, null, count]}>
            <planeGeometry args={[1, 1]}>
                <instancedBufferAttribute attach="attributes-color" args={[colorArray, 3]} />
            </planeGeometry>
            <meshBasicMaterial
                map={texture}
                transparent
                opacity={1}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                vertexColors
                toneMapped={false}
                side={THREE.DoubleSide}
            />
        </instancedMesh>
    );
};

export const BackgroundAlt = ({ audioStream, inputMode }) => {
    return (
        <div className="w-full h-full bg-black/0"> {/* Transparent background */}
            <Canvas camera={{ position: [0, 0, 40], fov: 50 }} gl={{ alpha: true, antialias: true }}>
                <Particles audioStream={audioStream} inputMode={inputMode} />
                <EffectComposer>
                    <Bloom luminanceThreshold={0.1} luminanceSmoothing={0.9} height={300} intensity={2.0} radius={0.8} />
                </EffectComposer>
            </Canvas>
        </div>
    );
};
