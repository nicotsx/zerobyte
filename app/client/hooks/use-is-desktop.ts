import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => Boolean(window.zerobyteDesktop);
const getServerSnapshot = () => false;

export const useIsDesktop = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
