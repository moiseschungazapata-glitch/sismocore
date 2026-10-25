"""Validated catalog predicates shared by API queries and authorized exports."""
from datetime import date
from math import radians, sin, cos, asin, sqrt, isfinite
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class CatalogFilters(BaseModel):
    model_config = ConfigDict(extra='forbid')
    q: str = Field('', max_length=200)
    magnitud: Literal['todos', 'menor', 'medio', 'mayor'] = 'todos'
    desde: date | None = None
    hasta: date | None = None
    mag_min: float | None = Field(None, ge=0, le=10, allow_inf_nan=False)
    mag_max: float | None = Field(None, ge=0, le=10, allow_inf_nan=False)
    prof_min: float | None = Field(None, ge=0, le=1000, allow_inf_nan=False)
    prof_max: float | None = Field(None, ge=0, le=1000, allow_inf_nan=False)
    region: str | None = Field(None, max_length=120)
    fuente: Literal['igp'] | None = None
    lat: float | None = Field(None, ge=-90, le=90, allow_inf_nan=False)
    lon: float | None = Field(None, ge=-180, le=180, allow_inf_nan=False)
    radio: float | None = Field(None, gt=0, le=2000, allow_inf_nan=False)
    poligono: list[tuple[float, float]] | None = Field(None, min_length=3, max_length=50)

    @model_validator(mode='after')
    def ranges(self):
        for low, high in [(self.desde, self.hasta), (self.mag_min, self.mag_max), (self.prof_min, self.prof_max)]:
            if low is not None and high is not None and low > high:
                raise ValueError('Rango inválido')
        circle = [self.lat, self.lon, self.radio]
        if any(v is not None for v in circle) and not all(v is not None for v in circle):
            raise ValueError('Área circular incompleta')
        if self.poligono and any(not isfinite(lat) or not isfinite(lon) or abs(lat) > 90 or abs(lon) > 180 for lat, lon in self.poligono):
            raise ValueError('Polígono inválido')
        return self

    def matches(self, event):
        if self.q.strip().lower() not in f'{event["lugar"]} {event["id_externo"]} {event["id"]}'.lower():
            return False
        day = event['ocurrido_en'][:10]
        if self.desde and day < self.desde.isoformat() or self.hasta and day > self.hasta.isoformat():
            return False
        if self.region and (event.get('region') or 'Sin región') != self.region:
            return False
        magnitude = event['magnitud']
        if self.magnitud != 'todos' and (magnitude is None or not (
            magnitude < 4 if self.magnitud == 'menor' else 4 <= magnitude < 6 if self.magnitud == 'medio' else magnitude >= 6)):
            return False
        for low, high, value in [(self.mag_min, self.mag_max, magnitude), (self.prof_min, self.prof_max, event['profundidad'])]:
            if (low is not None or high is not None) and (value is None or low is not None and value < low or high is not None and value > high):
                return False
        if self.radio is not None:
            lat, lon = event['latitud'], event['longitud']
            a = sin(radians(lat - self.lat)/2)**2 + cos(radians(lat))*cos(radians(self.lat))*sin(radians(lon-self.lon)/2)**2
            if 6371*2*asin(sqrt(min(1, a))) > self.radio + 1e-8:
                return False
        if self.poligono:
            lat, lon, inside = event['latitud'], event['longitud'], False
            for (y1, x1), (y2, x2) in zip(self.poligono, self.poligono[1:]+self.poligono[:1]):
                if abs((lon-x1)*(y2-y1)-(lat-y1)*(x2-x1)) < 1e-9 and min(x1,x2) <= lon <= max(x1,x2) and min(y1,y2) <= lat <= max(y1,y2):
                    return True
                if (y1 > lat) != (y2 > lat) and lon < (x2-x1)*(lat-y1)/(y2-y1)+x1:
                    inside = not inside
            return inside
        return True
