declare module "juce-framework-frontend" {
  export function getNativeFunction(name: string): (...args: unknown[]) => Promise<unknown>;
  export function getSliderState(name: string): unknown;
  export function getToggleState(name: string): unknown;
  export function getComboBoxState(name: string): unknown;
  export function getBackendResourceAddress(path: string): string;
}
