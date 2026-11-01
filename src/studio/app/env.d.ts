// A `.vue` file, to TypeScript: a component. Vite compiles it.
declare module "*.vue" {
    import type { DefineComponent } from "vue";
    const component: DefineComponent<object, object, unknown>;
    export default component;
}

// A stylesheet imported for its effect: Vite puts it in the page.
declare module "*.css";
