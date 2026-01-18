import React from 'react';

export const HeroAlt = ({ isActive, transcript, entityData, isAnalyzing, error, inputMode }) => {
    return (
        <div className="flex flex-col items-center text-center space-y-6 animate-[fadeIn_2s_ease-out] w-full max-w-4xl px-4">
            {isActive ? (
                <div className="min-h-[200px] flex items-center justify-center relative">
                    {error ? (
                        <div className="bg-red-900/40 backdrop-blur-md border border-red-500/30 p-8 rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.2)] animate-scale-in">
                            <h2 className="text-2xl font-light text-red-300 uppercase tracking-widest mb-2">Error Detected</h2>
                            <div className="text-xl font-bold text-white drop-shadow-[0_0_30px_rgba(239,68,68,0.5)]">
                                {error}
                            </div>
                        </div>
                    ) : entityData && !isAnalyzing ? (
                        <div className="bg-black/40 backdrop-blur-md border border-purple-500/30 p-8 rounded-2xl shadow-[0_0_50px_rgba(168,85,247,0.2)] animate-scale-in flex flex-col items-center max-w-2xl w-full">
                            <h3 className="text-purple-300/70 text-sm uppercase tracking-widest mb-4 border-b border-purple-500/20 pb-2 w-full text-center">
                                Input: "{transcript}"
                            </h3>

                            <h2 className="text-2xl font-light text-purple-300 uppercase tracking-widest mb-2">Entity Detected</h2>
                            <div className="text-5xl md:text-7xl font-bold text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)] mb-4">
                                {entityData.name}
                            </div>
                            <div className="inline-block px-4 py-1 rounded-full border border-white/20 bg-white/10 text-sm tracking-[0.3em] uppercase text-white/80">
                                {entityData.type}
                            </div>
                        </div>
                    ) : (
                        <h1 className={`text-4xl md:text-6xl font-light tracking-[0.1em] uppercase select-none vapor-text drop-shadow-[0_0_30px_rgba(168,85,247,0.5)] text-white break-words w-full transition-all duration-300 ${isAnalyzing ? 'animate-pulse opacity-70' : ''}`}>
                            {isAnalyzing
                                ? "Analyzing..."
                                : inputMode === 'text'
                                    ? <span>{transcript}<span className="w-1 h-12 bg-white/70 animate-pulse inline-block ml-1 align-middle"></span></span>
                                    : (transcript || "Listening...")}
                        </h1>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    <h1 className="text-8xl md:text-[12rem] font-light tracking-[0.3em] uppercase select-none vapor-text drop-shadow-[0_0_30px_rgba(168,85,247,0.5)] text-white">
                        AVTR
                    </h1>
                    <p className="text-purple-100/90 text-xl md:text-2xl font-light tracking-[0.5em] uppercase drop-shadow-[0_0_10px_rgba(216,180,254,0.6)]">
                        your digital twin
                    </p>
                </div>
            )}

            <style>{`
@keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); filter: blur(10px); }
          to { opacity: 1; transform: scale(1); filter: blur(0); }
}
@keyframes scaleIn {
            from { opacity: 0; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1); }
}
        .animate-scale-in {
    animation: scaleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
`}</style>
        </div>
    );
};
