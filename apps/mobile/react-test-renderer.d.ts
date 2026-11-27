/** Minimal local typings for the test renderer instance shape used in tests. */
declare module 'react-test-renderer' {
    export interface ReactTestInstance {
        type: unknown;
        props: Record<string, unknown>;
        children: unknown[];
        parent: ReactTestInstance | null;
    }
}
