declare module "*.svg?raw" {
  const source: string;
  export default source;
}

declare module "*.png?url" {
  const url: string;
  export default url;
}

declare module "*.css?raw" {
  const source: string;
  export default source;
}

declare module "*.html?raw" {
  const source: string;
  export default source;
}
