declare module 'lindenmayer' {
  type ProductionInfo = {
    index: number
    currentAxiom: string
    part: string
  }

  type Production = string | ((info: ProductionInfo) => string | false | undefined)

  export default class LSystem {
    constructor(options: {
      axiom: string
      productions: Record<string, Production>
    })
    iterate(iterations?: number): string
    getString(): string
  }
}
