"""Modello normalizzato di un annuncio (allineato a db/schema.sql e a apps/web/lib/types.ts)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Listing:
    source: str
    source_url: str
    source_id: str | None = None
    title: str | None = None
    price: int | None = None          # USD/mese
    currency: str = "USD"
    type: str | None = None           # 'studio' | '1br' | '2br' | ...
    furnished: bool | None = None
    sqft: int | None = None
    address_raw: str | None = None
    lat: float | None = None
    lng: float | None = None
    tier: str | None = None           # assegnato da classify()
    travel_minutes: int | None = None
    photos: list[str] = field(default_factory=list)
    raw: dict | None = None

    @property
    def geocoded(self) -> bool:
        return self.lat is not None and self.lng is not None
