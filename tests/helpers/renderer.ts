import type { RendererOptions } from 'vue';

/** 内存宿主保留真实 Vue 组件渲染、事件和生命周期，无需浏览器 DOM。 */
export interface TestNode {
  type: string;
  props: Record<string, any>;
  text: string;
  parent: TestNode | null;
  children: TestNode[];
}
export const node = (type = 'root', text = ''): TestNode => ({ type, text, props: {}, parent: null, children: [] });
export const roots = new Map<string, TestNode>();
function remove(child: TestNode) {
  if (!child.parent) return;
  const children = child.parent.children;
  const index = children.indexOf(child);
  if (index >= 0) children.splice(index, 1);
  child.parent = null;
}
function insert(child: TestNode, parent: TestNode, anchor?: TestNode | null) {
  remove(child);
  const index = anchor ? parent.children.indexOf(anchor) : -1;
  parent.children.splice(index >= 0 ? index : parent.children.length, 0, child);
  child.parent = parent;
}
export const host: RendererOptions<TestNode, TestNode> = {
  insert, remove,
  createElement: (type) => node(type),
  createText: (text) => node('text', text),
  createComment: (text) => node('comment', text),
  setText: (el, text) => { el.text = text; },
  setElementText: (el, text) => { for (const child of el.children) child.parent = null; el.children = []; el.text = text; },
  parentNode: (el) => el.parent,
  nextSibling: (el) => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  patchProp: (el, key, _prev, value) => { el.props[key] = value; },
  insertStaticContent: (content, parent, anchor) => {
    const el = node('static', content);
    insert(el, parent, anchor);
    return [el, el];
  },
};
export function find(root: TestNode, predicate: (node: TestNode) => boolean): TestNode | undefined {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
}
