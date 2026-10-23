export const V8_PREVIEW_HASH = '#/v8-preview'
export const isV8PreviewRoute = (development: boolean, hash: string) => development && hash === V8_PREVIEW_HASH
