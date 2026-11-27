/**
 * Visibility helpers for render tests.
 *
 * `toBeVisible()` from @testing-library/react-native catches display:none and
 * opacity:0 on the element itself, but it does NOT know about layout collapse:
 * React Native gives a child with `flex: 1` zero height when its parent has no
 * bounded size. This helper walks every ancestor and fails on:
 *
 *  - opacity: 0 (on the element or any ancestor),
 *  - display: 'none',
 *  - explicit width/height: 0,
 *  - a style-less View directly wrapping a `flex: 1` child (unbounded parent).
 *
 * The last rule reproduces the release-build symptom where screens mounted but
 * occupied zero pixels, so nothing except intrinsically-sized fragments was
 * visible. It deliberately ignores host internals such as RCTScrollView.
 */

import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

function nodeName(node: ReactTestInstance): string {
    if (typeof node.type === 'string') return node.type;
    const type = node.type as { displayName?: string; name?: string };
    return type.displayName ?? type.name ?? 'Component';
}

function hostChildren(node: ReactTestInstance): ReactTestInstance[] {
    return node.children.filter((child): child is ReactTestInstance =>
        Boolean(child) && typeof child === 'object' && typeof (child as ReactTestInstance).type === 'string',
    );
}

function flattenStyle(node: ReactTestInstance): Record<string, unknown> {
    const style = StyleSheet.flatten(node.props.style ?? []) as Record<string, unknown> | null;
    return style ?? {};
}

function isUnboundedWrapper(node: ReactTestInstance): boolean {
    if (node.type !== 'View') return false;
    // A View with *no style at all* cannot bound a flex:1 child in a native
    // flex layout. Any explicit dimension/flex means the caller opted in.
    if (node.props.style !== undefined) return false;
    return hostChildren(node).some((child) => {
        const style = flattenStyle(child);
        return style.flex === 1 || style.flexGrow === 1;
    });
}

export interface VisibilityProblem {
    node: string;
    problem: string;
}

/** Returns every visibility/layout problem on the element's ancestor chain. */
export function findVisibilityProblems(element: ReactTestInstance): VisibilityProblem[] {
    const problems: VisibilityProblem[] = [];
    let node: ReactTestInstance | null = element;
    while (node) {
        const style = flattenStyle(node);
        const name = nodeName(node);
        if (style.opacity === 0) problems.push({ node: name, problem: 'opacity: 0' });
        if (style.display === 'none') problems.push({ node: name, problem: 'display: none' });
        if (style.height === 0) problems.push({ node: name, problem: 'height: 0' });
        if (style.width === 0) problems.push({ node: name, problem: 'width: 0' });
        if (isUnboundedWrapper(node)) {
            problems.push({
                node: name,
                problem: 'style-less View wrapping a flex:1 child (collapses to height 0 in native layout)',
            });
        }
        node = node.parent;
    }
    return problems;
}

/** Assert that a text/element is visible AND not hidden by an ancestor. */
export function expectVisible(element: ReactTestInstance): void {
    expect(element).toBeVisible();
    expect(findVisibilityProblems(element)).toEqual([]);
}

/**
 * Convenience: assert at least one matching node is visible. Duplicate labels
 * are normal (e.g. a league chip and a league header both say "Premier
 * League"), so getAllByText is used instead of getByText.
 */
export function expectTextVisible(
    screen: { getAllByText: (text: string | RegExp) => ReactTestInstance[] },
    text: string | RegExp,
): void {
    const nodes = screen.getAllByText(text);
    const problems = nodes.map((node) => findVisibilityProblems(node));
    const visible = nodes.filter((_node, index) => problems[index].length === 0);
    if (visible.length === 0) {
        throw new Error(
            `No visible node for ${String(text)}. Visibility problems: ${JSON.stringify(problems)}`,
        );
    }
    expect(visible[0]).toBeVisible();
}
