import { something } from "some-package";

export function greet(name: string): string {
  return `hello, ${name}`;
}

const value = something(42);
export { value };
