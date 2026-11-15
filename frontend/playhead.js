import {create} from 'zustand';
// Tiny store so only the playhead and timecode re-render at video frame rate.
export const usePlayhead = create(() => ({cursor: 0, playing: false}));
export const setPlayhead = patch => usePlayhead.setState(patch);
