import { DisasterTypeSchema, buildExpenditureFunctionModule } from '@jaga-daerah/contracts';
import type {
  MapRealization,
  BudgetModule,
  DataStatus,
  DisasterModule,
  DisasterType,
  MetaStatus,
  RegionProfile,
  Source,
} from '@jaga-daerah/contracts';

import type {
  BudgetRecord,
  DisasterRecord,
  ProfileRepository,
  SourceRecord,
} from '#api/repositories/profile-repository';
import { compareWithMedian, realizationPercent } from '#api/services/budget-metrics';
import { buildExpenditureBreakdownModule } from '#api/services/expenditure-breakdown';
import { buildNaturalResourceModule } from '#api/services/natural-resources';
import { budgetNarrative } from '#api/services/profile-narrative';

export const DISASTER_LABELS: Record<DisasterType, string> = {
  banjir: 'Banjir',
  cuaca_ekstrem: 'Cuaca ekstrem',
  erupsi_gunung_api: 'Erupsi gunung api',
  gelombang_pasang_abrasi: 'Gelombang pasang dan abrasi',
  gempabumi: 'Gempabumi',
  kebakaran_hutan_lahan: 'Kebakaran hutan dan lahan',
  kekeringan: 'Kekeringan',
  tanah_longsor: 'Tanah longsor',
  tsunami: 'Tsunami',
};
const DISASTER_TYPES = DisasterTypeSchema.options;
const METRICS = ['eventCount', 'deaths', 'missing', 'affected'] as const;

export type RegionProfileResult =
  | { kind: 'found'; profile: RegionProfile; datasetVersion: string }
  | { kind: 'region-not-found' }
  | { kind: 'no-published-dataset' }
  | { kind: 'year-unavailable'; availableYears: number[] };

function budgetStatus(record: BudgetRecord | undefined): DataStatus {
  if (record === undefined) return 'unavailable';
  if (record.budgetAmount === null && record.realizationAmount === null) return 'unavailable';
  if (record.budgetAmount === null || record.realizationAmount === null) return 'partial';
  return 'complete';
}

function isDisasterType(value: string): value is DisasterType {
  return value in DISASTER_LABELS;
}

/** Sum that stays NULL only when every value is NULL; any reported number counts. */
function sumOrNull(values: (number | null)[]): number | null {
  const reported = values.filter((value): value is number => value !== null);
  return reported.length === 0 ? null : reported.reduce((total, value) => total + value, 0);
}

export function buildDisasterModule(
  province: DisasterModule['province'],
  records: DisasterRecord[],
  notes: string[],
): DisasterModule {
  const byType = DISASTER_TYPES.map((type) => {
    const record = records.find((row) => row.disasterType === type);
    return {
      type,
      label: DISASTER_LABELS[type],
      event_count: record?.eventCount ?? null,
      deaths: record?.deaths ?? null,
      missing: record?.missing ?? null,
      affected: record?.affected ?? null,
    };
  });
  const known = records.filter((row) => isDisasterType(row.disasterType));
  const values = known.flatMap((row) => METRICS.map((metric) => row[metric]));

  let status: DataStatus = 'complete';
  if (known.length === 0) status = 'unavailable';
  else if (known.length < DISASTER_TYPES.length || values.some((value) => value === null)) {
    status = 'partial';
  }

  return {
    level: 'provinsi',
    province,
    status,
    totals: {
      event_count: sumOrNull(known.map((row) => row.eventCount)),
      deaths: sumOrNull(known.map((row) => row.deaths)),
      missing: sumOrNull(known.map((row) => row.missing)),
      affected: sumOrNull(known.map((row) => row.affected)),
    },
    by_type: byType,
    notes,
  };
}

export function toSource(record: SourceRecord): Source {
  return {
    publisher: record.publisher,
    title: record.title,
    source_url: record.sourceUrl,
    period: record.period,
    downloaded_at: record.downloadedAt.toISOString(),
  };
}

export async function getRegionProfile(
  repository: ProfileRepository,
  params: { slug: string; year: number | undefined },
): Promise<RegionProfileResult> {
  const [version, region] = await Promise.all([
    repository.findActiveVersion(),
    repository.findRegionBySlug(params.slug),
  ]);
  if (region === undefined) return { kind: 'region-not-found' };
  if (version === undefined) return { kind: 'no-published-dataset' };

  const availableYears = await repository.listAvailableYears(version.id, region);
  // Default to the latest year with data (PRD §16: tahun terbaru yang tersedia).
  const year = params.year ?? availableYears[0];
  if (year === undefined || !availableYears.includes(year)) {
    return { kind: 'year-unavailable', availableYears };
  }

  const [budgetRecord, median, expenditures, functions, resources, disasters, notes, sources] =
    await Promise.all([
      repository.findBudget(version.id, region.id, year),
      repository.findNationalMedianPercent(version.id, year),
      repository.listExpenditures(version.id, region.id, year),
      repository.listExpenditureFunctions(version.id, region.id, year),
      repository.listNaturalResources(version.id, region.id, year),
      repository.listDisasters(version.id, region.province.id, year),
      repository.listDisasterNotes(version.id, year),
      repository.listSources(version.id),
    ]);

  const budgetAmount = budgetRecord?.budgetAmount ?? null;
  const realizationAmount = budgetRecord?.realizationAmount ?? null;
  const percent = realizationPercent(budgetAmount, realizationAmount);
  const comparison = compareWithMedian(percent, median);
  const status = budgetStatus(budgetRecord);
  const budget: BudgetModule = {
    status,
    budget_amount: budgetAmount,
    realization_amount: realizationAmount,
    realization_percent: percent,
    national_median_percent: median,
    median_comparison: comparison,
    narrative: budgetNarrative({
      regionName: region.name,
      year,
      status,
      realizationPercent: percent,
      nationalMedianPercent: median,
      comparison,
    }),
  };

  const province = {
    code: region.province.code,
    name: region.province.name,
    slug: region.province.slug,
  };
  return {
    kind: 'found',
    datasetVersion: version.version,
    profile: {
      region: {
        code: region.code,
        name: region.name,
        slug: region.slug,
        type: region.type,
        province,
      },
      year,
      available_years: availableYears,
      budget,
      expenditure_breakdown: buildExpenditureBreakdownModule(
        region.name,
        year,
        expenditures,
        budgetAmount,
        realizationAmount,
      ),
      expenditure_by_function: buildExpenditureFunctionModule(
        region.name,
        year,
        functions.map((row) => ({
          type: row.functionType,
          budgetAmount: row.budgetAmount,
          realizationAmount: row.realizationAmount,
        })),
      ),
      natural_resources: buildNaturalResourceModule(region.name, year, resources),
      disaster: buildDisasterModule(province, disasters, notes),
      sources: sources.map(toSource),
      published_at: version.publishedAt.toISOString(),
    },
  };
}

export async function getMetaStatus(
  repository: ProfileRepository,
): Promise<{ status: MetaStatus; datasetVersion: string | null }> {
  const version = await repository.findActiveVersion();
  if (version === undefined) {
    return {
      datasetVersion: null,
      status: {
        dataset_version: null,
        published_at: null,
        years: [],
        coverage: { provinces: 0, regions: 0, regions_with_budget: 0 },
        sources: [],
      },
    };
  }
  const [years, coverage, sources] = await Promise.all([
    repository.listPublishedYears(version.id),
    repository.countCoverage(version.id),
    repository.listSources(version.id),
  ]);
  return {
    datasetVersion: version.version,
    status: {
      dataset_version: version.version,
      published_at: version.publishedAt.toISOString(),
      years,
      coverage: {
        provinces: coverage.provinces,
        regions: coverage.regions,
        regions_with_budget: coverage.regionsWithBudget,
      },
      sources: sources.map(toSource),
    },
  };
}

export type MapRealizationResult =
  | { kind: 'found'; map: MapRealization; datasetVersion: string }
  | { kind: 'no-published-dataset' }
  | { kind: 'year-unavailable'; availableYears: number[] };

/** Realisation percent per kab/kota for the national choropleth (same rules as profiles). */
export async function getMapRealization(
  repository: ProfileRepository,
  params: { year: number | undefined },
): Promise<MapRealizationResult> {
  const version = await repository.findActiveVersion();
  if (version === undefined) return { kind: 'no-published-dataset' };

  const availableYears = (await repository.listPublishedYears(version.id)).toSorted(
    (a, b) => b - a,
  );
  const year = params.year ?? availableYears[0];
  if (year === undefined || !availableYears.includes(year)) {
    return { kind: 'year-unavailable', availableYears };
  }

  const [rows, median] = await Promise.all([
    repository.listRegionBudgets(version.id, year),
    repository.findNationalMedianPercent(version.id, year),
  ]);
  return {
    kind: 'found',
    datasetVersion: version.version,
    map: {
      year,
      available_years: availableYears,
      national_median_percent: median,
      items: rows.map((row) => {
        const percent = realizationPercent(row.budgetAmount, row.realizationAmount);
        return {
          code: row.code,
          realization_percent: percent,
          median_comparison: compareWithMedian(percent, median),
        };
      }),
    },
  };
}
