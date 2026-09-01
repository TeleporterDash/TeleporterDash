import AudioManager from "./audioManager";
import { createContext, useContext } from "@nisoku/sairin";

// Singleton audio manager instance used across the app
export const audioManager = new AudioManager();

// Sairin context for providing audioManager to consumers
export const AudioContext = createContext(audioManager, "AudioManager");

export function useAudioManager(): typeof audioManager {
  return useContext(AudioContext) as typeof audioManager;
}

export default {
  audioManager,
  AudioContext,
  useAudioManager,
};
