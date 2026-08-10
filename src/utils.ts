/**
 * Debounce helper — direct port of node-routeros utils.debounce.
 * Returns { run, cancel } object matching the original API.
 */
export const debounce = (
  callback: (...args: any[]) => void,
  timeout: number = 0,
): { run: (...args: any[]) => void; cancel: () => void } => {
  let timeoutObj: ReturnType<typeof setTimeout> | null = null;

  return {
    run: (...args: any[]) => {
      const context = this;
      clearTimeout(timeoutObj as ReturnType<typeof setTimeout>);
      timeoutObj = setTimeout(() => callback.apply(context, args), timeout);
    },
    cancel: () => {
      clearTimeout(timeoutObj as ReturnType<typeof setTimeout>);
    },
  };
};
