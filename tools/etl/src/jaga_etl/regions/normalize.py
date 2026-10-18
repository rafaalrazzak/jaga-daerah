"""Parse the upstream SQL dump into province and kabupaten/kota records.

The dump is treated as untrusted text: it is never executed. Only `('code','name')` value
tuples are read, and only the province (`NN`) and kabupaten/kota (`NN.NN`) levels are kept.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

RegionType = Literal["kabupaten", "kota"]

VALUE_TUPLE = re.compile(r"\('(?P<code>[0-9.]+)','(?P<name>(?:[^'\\]|\\.|'')*)'\)")
PROVINCE_CODE = re.compile(r"^[0-9]{2}$")
REGION_CODE = re.compile(r"^[0-9]{2}\.[0-9]{2}$")
REGION_TYPE_PREFIXES: tuple[tuple[str, RegionType], ...] = (
    ("Kabupaten ", "kabupaten"),
    ("Kota ", "kota"),
)


@dataclass(frozen=True)
class Province:
    code: str
    name: str
    slug: str


@dataclass(frozen=True)
class Region:
    code: str
    province_code: str
    name: str
    slug: str
    type: RegionType


@dataclass(frozen=True)
class Rejection:
    code: str
    name: str
    reason: str


@dataclass(frozen=True)
class NormalizedRegions:
    provinces: list[Province]
    regions: list[Region]
    rejections: list[Rejection]


def normalize_name(raw: str) -> str:
    unescaped = raw.replace("''", "'").replace("\\'", "'")
    return " ".join(unicodedata.normalize("NFC", unescaped).split())


def slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def region_type_of(name: str) -> RegionType | None:
    for prefix, region_type in REGION_TYPE_PREFIXES:
        if name.startswith(prefix):
            return region_type
    return None


def normalize(dump: str) -> NormalizedRegions:
    provinces: list[Province] = []
    regions: list[Region] = []
    rejections: list[Rejection] = []

    for match in VALUE_TUPLE.finditer(dump):
        code = match.group("code")
        name = normalize_name(match.group("name"))

        if PROVINCE_CODE.fullmatch(code):
            provinces.append(Province(code=code, name=name, slug=slugify(name)))
        elif REGION_CODE.fullmatch(code):
            region_type = region_type_of(name)
            if region_type is None:
                rejections.append(Rejection(code, name, "name has no Kabupaten/Kota prefix"))
                continue
            regions.append(
                Region(
                    code=code,
                    province_code=code[:2],
                    name=name,
                    slug=slugify(name),
                    type=region_type,
                )
            )

    return NormalizedRegions(provinces=provinces, regions=regions, rejections=rejections)
