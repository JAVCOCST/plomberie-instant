import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installGlobalAudioUnlock } from "./lib/unlockAudio";

// Arm a one-shot global gesture listener so the very first user touch
// anywhere unlocks the AudioContext (iOS / Safari / Chrome autoplay policy).
installGlobalAudioUnlock();

createRoot(document.getElementById("root")!).render(<App />);
