import hashlib
from dataclasses import replace
from pathlib import Path

import pytest

from jaga_etl.regions.extract import ChecksumMismatchError, extract
from jaga_etl.regions.normalize import normalize, slugify
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.regions.validate import OfficialCount, read_official_counts, validate

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_DUMP = (FIXTURES / "wilayah_sample.sql").read_text(encoding="utf-8")
OFFICIAL_RECAP = Path(__file__).parents[1] / "reference" / "kepmendagri-300.2.2-2430-2025-recap.csv"

SAMPLE_OFFICIAL = {
    "11": OfficialCount("11", kabupaten=1, kota=1),
    "31": OfficialCount("31", kabupaten=1, kota=1),
    "32": OfficialCount("32", kabupaten=1, kota=1),
}


def test_keeps_only_province_and_regency_levels_with_codes_as_strings():
    data = normalize(SAMPLE_DUMP)

    assert [p.code for p in data.provinces] == ["11", "31", "32"]
    assert [r.code for r in data.regions] == ["11.01", "11.71", "31.01", "31.72", "32.04", "32.73"]
    assert data.rejections == []


def test_normalizes_whitespace_and_derives_type_and_slug():
    regions = {r.code: r for r in normalize(SAMPLE_DUMP).regions}

    assert regions["31.72"].name == "Kota Administrasi Jakarta Utara"
    assert regions["32.73"].name == "Kota Bandung"
    assert regions["32.73"].slug == "kota-bandung"
    assert regions["32.04"].type == "kabupaten"
    assert regions["31.01"].type == "kabupaten"
    assert regions["31.72"].province_code == "31"


def test_slugify_strips_accents_and_punctuation():
    assert slugify("Kepulauan Bangka-Belitung") == "kepulauan-bangka-belitung"
    assert slugify("Kota Bau'-Bau") == "kota-bau-bau"
    assert slugify("Daérah Istimewa  Yogyakarta") == "daerah-istimewa-yogyakarta"


def test_rejects_regency_names_without_kabupaten_or_kota_prefix():
    data = normalize("('11','Aceh'),('11.01','Aceh Selatan')")

    assert data.regions == []
    assert data.rejections[0].code == "11.01"
    assert not validate(data, {"11": OfficialCount("11", 0, 0)}).is_valid


def test_sample_passes_quality_gate_against_matching_counts():
    result = validate(normalize(SAMPLE_DUMP), SAMPLE_OFFICIAL)

    assert result.errors == []


def test_quality_gate_fails_when_counts_differ_from_official_recap():
    official = {**SAMPLE_OFFICIAL, "32": OfficialCount("32", kabupaten=2, kota=1)}

    result = validate(normalize(SAMPLE_DUMP), official)

    assert result.errors == ["province 32: 1 kabupaten in source, official recap says 2"]


def test_quality_gate_fails_on_duplicate_codes_and_slugs():
    dump = SAMPLE_DUMP + "\n('32.79','Kota Bandung'),('32.04','Kabupaten Garut')"

    errors = validate(normalize(dump), SAMPLE_OFFICIAL).errors

    assert "duplicate region code: 32.04" in errors
    assert "duplicate region slug: kota-bandung" in errors


def test_quality_gate_fails_on_missing_or_unexpected_province():
    official = {**SAMPLE_OFFICIAL, "51": OfficialCount("51", 0, 0)}

    errors = validate(normalize(SAMPLE_DUMP), official).errors

    assert any("missing=['51']" in error for error in errors)


def test_official_recap_totals_match_kepmendagri_2430():
    official = read_official_counts(OFFICIAL_RECAP)

    assert len(official) == 38
    assert sum(c.kabupaten for c in official.values()) == 416
    assert sum(c.kota for c in official.values()) == 98


def test_extract_verifies_checksum_and_never_overwrites_raw_files(tmp_path: Path):
    content = SAMPLE_DUMP.encode("utf-8")
    source_path = tmp_path / "upstream.sql"
    source_path.write_bytes(content)
    source = replace(
        REGION_CODE_SOURCE,
        url=source_path.as_uri(),
        sha256=hashlib.sha256(content).hexdigest(),
    )
    raw_directory = tmp_path / "raw"

    first = extract(source, raw_directory)
    second = extract(source, raw_directory)

    assert first.path.read_bytes() == content
    assert second.downloaded_at == first.downloaded_at
    assert first.path.with_suffix(".provenance.json").exists()

    with pytest.raises(ChecksumMismatchError):
        extract(replace(source, sha256="0" * 64), raw_directory)
    assert first.path.read_bytes() == content


def test_extract_rejects_content_that_does_not_match_the_pin(tmp_path: Path):
    source_path = tmp_path / "upstream.sql"
    source_path.write_bytes(b"tampered")
    source = replace(REGION_CODE_SOURCE, url=source_path.as_uri())

    with pytest.raises(ChecksumMismatchError):
        extract(source, tmp_path / "raw")
    assert not (tmp_path / "raw" / f"wilayah-{source.commit[:12]}.sql").exists()
