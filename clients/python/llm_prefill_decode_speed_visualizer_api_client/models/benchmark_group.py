from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.benchmark_group_context_bands import BenchmarkGroupContextBands
    from ..models.benchmark_group_data_quality_type_0 import BenchmarkGroupDataQualityType0
    from ..models.benchmark_group_freshness import BenchmarkGroupFreshness
    from ..models.benchmark_group_outliers_item import BenchmarkGroupOutliersItem
    from ..models.best_run_summary import BestRunSummary
    from ..models.caveat import Caveat
    from ..models.confidence import Confidence
    from ..models.cross_check import CrossCheck
    from ..models.speed_stats import SpeedStats


T = TypeVar("T", bound="BenchmarkGroup")


@_attrs_define
class BenchmarkGroup:
    """Aggregated speeds for one group (hardware×model-family by default; regroup with ?groupBy=). Medians are outlier-
    resistant and carry 95% bootstrap CIs.

        Attributes:
            key (str): Group key, e.g. "rtx4090|qwen3.6-27b" Example: rtx4090|qwen3.6-27b.
            runs (int): Comparable runs in the group
            prefill (SpeedStats): Outlier-resistant distribution stats for one metric within a group.
            decode (SpeedStats): Outlier-resistant distribution stats for one metric within a group.
            model_families (list[str] | Unset):
            engines (list[str] | Unset):
            mixed_engines (bool | Unset): True when the group spans multiple engine builds — check freshness before
                comparing
            mixed_context_bands (bool | None | Unset): Present (true) only when ?context_band= filtering is off and the
                group mixes bands
            data_quality (BenchmarkGroupDataQualityType0 | None | Unset): Unit-consistency audit over the group's runs
                (status ok|flagged).
            caveats (list[Caveat] | Unset): Per-group flags (n=1 group, mixed engines)
            confidence (Confidence | Unset): How much to trust one aggregate: sample size, decode-IQR width, outlier
                density, recency and an overall grade.
            cross_check (CrossCheck | Unset): Sanity comparison of multi-GPU rigs against the single-GPU baseline on the
                same model/quant.
            best_run (BestRunSummary | Unset): The single fastest measured run inside a group.
            runs_in_stats (int | Unset): Runs actually included in the stats (outliers excluded by default)
            outliers_excluded_from_stats (int | Unset): Runs fenced out of the stats by the IQR outlier rule
            outlier_iqrs (float | Unset): Outlier fence in IQRs from the group median (see top-level outlierPolicy)
            include_outliers (bool | Unset): Whether outlier runs were included (echoes ?include_outliers=)
            outliers (list[BenchmarkGroupOutliersItem] | Unset): Flagged outlier runs (empty unless ?include_outliers=true);
                each carries the metrics that tripped the fence plus a z-score-style deviation.
            context_bands (BenchmarkGroupContextBands | Unset): Context-length band mix inside the group — speeds depend on
                context, so a mixed group blends regimes.
            freshness (BenchmarkGroupFreshness | Unset): Recency of the runs backing this group.
    """

    key: str
    runs: int
    prefill: SpeedStats
    decode: SpeedStats
    model_families: list[str] | Unset = UNSET
    engines: list[str] | Unset = UNSET
    mixed_engines: bool | Unset = UNSET
    mixed_context_bands: bool | None | Unset = UNSET
    data_quality: BenchmarkGroupDataQualityType0 | None | Unset = UNSET
    caveats: list[Caveat] | Unset = UNSET
    confidence: Confidence | Unset = UNSET
    cross_check: CrossCheck | Unset = UNSET
    best_run: BestRunSummary | Unset = UNSET
    runs_in_stats: int | Unset = UNSET
    outliers_excluded_from_stats: int | Unset = UNSET
    outlier_iqrs: float | Unset = UNSET
    include_outliers: bool | Unset = UNSET
    outliers: list[BenchmarkGroupOutliersItem] | Unset = UNSET
    context_bands: BenchmarkGroupContextBands | Unset = UNSET
    freshness: BenchmarkGroupFreshness | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.benchmark_group_data_quality_type_0 import BenchmarkGroupDataQualityType0

        key = self.key

        runs = self.runs

        prefill = self.prefill.to_dict()

        decode = self.decode.to_dict()

        model_families: list[str] | Unset = UNSET
        if not isinstance(self.model_families, Unset):
            model_families = self.model_families

        engines: list[str] | Unset = UNSET
        if not isinstance(self.engines, Unset):
            engines = self.engines

        mixed_engines = self.mixed_engines

        mixed_context_bands: bool | None | Unset
        if isinstance(self.mixed_context_bands, Unset):
            mixed_context_bands = UNSET
        else:
            mixed_context_bands = self.mixed_context_bands

        data_quality: dict[str, Any] | None | Unset
        if isinstance(self.data_quality, Unset):
            data_quality = UNSET
        elif isinstance(self.data_quality, BenchmarkGroupDataQualityType0):
            data_quality = self.data_quality.to_dict()
        else:
            data_quality = self.data_quality

        caveats: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.caveats, Unset):
            caveats = []
            for caveats_item_data in self.caveats:
                caveats_item = caveats_item_data.to_dict()
                caveats.append(caveats_item)

        confidence: dict[str, Any] | Unset = UNSET
        if not isinstance(self.confidence, Unset):
            confidence = self.confidence.to_dict()

        cross_check: dict[str, Any] | Unset = UNSET
        if not isinstance(self.cross_check, Unset):
            cross_check = self.cross_check.to_dict()

        best_run: dict[str, Any] | Unset = UNSET
        if not isinstance(self.best_run, Unset):
            best_run = self.best_run.to_dict()

        runs_in_stats = self.runs_in_stats

        outliers_excluded_from_stats = self.outliers_excluded_from_stats

        outlier_iqrs = self.outlier_iqrs

        include_outliers = self.include_outliers

        outliers: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.outliers, Unset):
            outliers = []
            for outliers_item_data in self.outliers:
                outliers_item = outliers_item_data.to_dict()
                outliers.append(outliers_item)

        context_bands: dict[str, Any] | Unset = UNSET
        if not isinstance(self.context_bands, Unset):
            context_bands = self.context_bands.to_dict()

        freshness: dict[str, Any] | Unset = UNSET
        if not isinstance(self.freshness, Unset):
            freshness = self.freshness.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "runs": runs,
                "prefill": prefill,
                "decode": decode,
            }
        )
        if model_families is not UNSET:
            field_dict["modelFamilies"] = model_families
        if engines is not UNSET:
            field_dict["engines"] = engines
        if mixed_engines is not UNSET:
            field_dict["mixedEngines"] = mixed_engines
        if mixed_context_bands is not UNSET:
            field_dict["mixedContextBands"] = mixed_context_bands
        if data_quality is not UNSET:
            field_dict["dataQuality"] = data_quality
        if caveats is not UNSET:
            field_dict["caveats"] = caveats
        if confidence is not UNSET:
            field_dict["confidence"] = confidence
        if cross_check is not UNSET:
            field_dict["crossCheck"] = cross_check
        if best_run is not UNSET:
            field_dict["bestRun"] = best_run
        if runs_in_stats is not UNSET:
            field_dict["runsInStats"] = runs_in_stats
        if outliers_excluded_from_stats is not UNSET:
            field_dict["outliersExcludedFromStats"] = outliers_excluded_from_stats
        if outlier_iqrs is not UNSET:
            field_dict["outlierIqrs"] = outlier_iqrs
        if include_outliers is not UNSET:
            field_dict["includeOutliers"] = include_outliers
        if outliers is not UNSET:
            field_dict["outliers"] = outliers
        if context_bands is not UNSET:
            field_dict["contextBands"] = context_bands
        if freshness is not UNSET:
            field_dict["freshness"] = freshness

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.benchmark_group_context_bands import BenchmarkGroupContextBands
        from ..models.benchmark_group_data_quality_type_0 import BenchmarkGroupDataQualityType0
        from ..models.benchmark_group_freshness import BenchmarkGroupFreshness
        from ..models.benchmark_group_outliers_item import BenchmarkGroupOutliersItem
        from ..models.best_run_summary import BestRunSummary
        from ..models.caveat import Caveat
        from ..models.confidence import Confidence
        from ..models.cross_check import CrossCheck
        from ..models.speed_stats import SpeedStats

        d = dict(src_dict)
        key = d.pop("key")

        runs = d.pop("runs")

        prefill = SpeedStats.from_dict(d.pop("prefill"))

        decode = SpeedStats.from_dict(d.pop("decode"))

        model_families = cast(list[str], d.pop("modelFamilies", UNSET))

        engines = cast(list[str], d.pop("engines", UNSET))

        mixed_engines = d.pop("mixedEngines", UNSET)

        def _parse_mixed_context_bands(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        mixed_context_bands = _parse_mixed_context_bands(d.pop("mixedContextBands", UNSET))

        def _parse_data_quality(data: object) -> BenchmarkGroupDataQualityType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                data_quality_type_0 = BenchmarkGroupDataQualityType0.from_dict(data)

                return data_quality_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BenchmarkGroupDataQualityType0 | None | Unset, data)

        data_quality = _parse_data_quality(d.pop("dataQuality", UNSET))

        _caveats = d.pop("caveats", UNSET)
        caveats: list[Caveat] | Unset = UNSET
        if _caveats is not UNSET:
            caveats = []
            for caveats_item_data in _caveats:
                caveats_item = Caveat.from_dict(caveats_item_data)

                caveats.append(caveats_item)

        _confidence = d.pop("confidence", UNSET)
        confidence: Confidence | Unset
        if isinstance(_confidence, Unset):
            confidence = UNSET
        else:
            confidence = Confidence.from_dict(_confidence)

        _cross_check = d.pop("crossCheck", UNSET)
        cross_check: CrossCheck | Unset
        if isinstance(_cross_check, Unset):
            cross_check = UNSET
        else:
            cross_check = CrossCheck.from_dict(_cross_check)

        _best_run = d.pop("bestRun", UNSET)
        best_run: BestRunSummary | Unset
        if isinstance(_best_run, Unset):
            best_run = UNSET
        else:
            best_run = BestRunSummary.from_dict(_best_run)

        runs_in_stats = d.pop("runsInStats", UNSET)

        outliers_excluded_from_stats = d.pop("outliersExcludedFromStats", UNSET)

        outlier_iqrs = d.pop("outlierIqrs", UNSET)

        include_outliers = d.pop("includeOutliers", UNSET)

        _outliers = d.pop("outliers", UNSET)
        outliers: list[BenchmarkGroupOutliersItem] | Unset = UNSET
        if _outliers is not UNSET:
            outliers = []
            for outliers_item_data in _outliers:
                outliers_item = BenchmarkGroupOutliersItem.from_dict(outliers_item_data)

                outliers.append(outliers_item)

        _context_bands = d.pop("contextBands", UNSET)
        context_bands: BenchmarkGroupContextBands | Unset
        if isinstance(_context_bands, Unset):
            context_bands = UNSET
        else:
            context_bands = BenchmarkGroupContextBands.from_dict(_context_bands)

        _freshness = d.pop("freshness", UNSET)
        freshness: BenchmarkGroupFreshness | Unset
        if isinstance(_freshness, Unset):
            freshness = UNSET
        else:
            freshness = BenchmarkGroupFreshness.from_dict(_freshness)

        benchmark_group = cls(
            key=key,
            runs=runs,
            prefill=prefill,
            decode=decode,
            model_families=model_families,
            engines=engines,
            mixed_engines=mixed_engines,
            mixed_context_bands=mixed_context_bands,
            data_quality=data_quality,
            caveats=caveats,
            confidence=confidence,
            cross_check=cross_check,
            best_run=best_run,
            runs_in_stats=runs_in_stats,
            outliers_excluded_from_stats=outliers_excluded_from_stats,
            outlier_iqrs=outlier_iqrs,
            include_outliers=include_outliers,
            outliers=outliers,
            context_bands=context_bands,
            freshness=freshness,
        )

        benchmark_group.additional_properties = d
        return benchmark_group

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
