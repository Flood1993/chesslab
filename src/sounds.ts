export function playSound(audio: HTMLAudioElement) {
  audio.currentTime = 0;
  audio.play();
}

export const audioCapture = new Audio(`${import.meta.env.BASE_URL}/sound/Capture.mp3`);
export const audioGameEnd = new Audio(`${import.meta.env.BASE_URL}/sound/Victory.mp3`);
export const audioGameStart = new Audio(`${import.meta.env.BASE_URL}/sound/GenericNotify.mp3`);
export const audioIllegalMove = new Audio(`${import.meta.env.BASE_URL}/sound/Error.mp3`);
export const audioSelfMove = new Audio(`${import.meta.env.BASE_URL}/sound/Move.mp3`);
