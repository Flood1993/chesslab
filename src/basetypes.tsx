export class Move {
  from: string;
  to: string;
  promotion?: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

  constructor(from: string, to: string, promotion?: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king") {
    this.from = from;
    this.to = to;
    this.promotion = promotion;
  }

  toString() {
    return `[${this.from} -> ${this.to}${this.promotion ? "=" + this.promotion : ""}]`;
  }

  equals(o?: Move) {
    if (!this || !o) return false;
    // There's some issue with null vs undefined
    return this.from === o.from && this.to === o.to && (this.promotion ?? null) === (o.promotion ?? null);
  }
}
