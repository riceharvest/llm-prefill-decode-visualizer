from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.best_result_hw_class_type_1 import BestResultHwClassType1
from ..models.best_result_hw_class_type_2_type_1 import BestResultHwClassType2Type1
from ..models.best_result_hw_class_type_3_type_1 import BestResultHwClassType3Type1
from ..models.best_result_staleness_type_1 import BestResultStalenessType1
from ..models.best_result_staleness_type_2_type_1 import BestResultStalenessType2Type1
from ..models.best_result_staleness_type_3_type_1 import BestResultStalenessType3Type1
from ..types import UNSET, Unset
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.best_result_context_bands import BestResultContextBands
  from ..models.best_result_data_quality_type_0 import BestResultDataQualityType0
  from ..models.best_result_median_decode_ci_95 import BestResultMedianDecodeCi95
  from ..models.best_result_median_prefill_ci_95 import BestResultMedianPrefillCi95
  from ..models.best_result_power_type_0 import BestResultPowerType0
  from ..models.best_result_pricing_type_0 import BestResultPricingType0
  from ..models.best_result_vram_fit_type_0 import BestResultVramFitType0
  from ..models.caveat import Caveat
  from ..models.confidence import Confidence





T = TypeVar("T", bound="BestResult")



@_attrs_define
class BestResult:
    """ One ranked hardware×model recommendation. Medians carry 95% bootstrap CIs (medianXxxCi95 / medianXxxLabel);
    pricing/power/vramFit are estimates anchored on the group's best-measured run and are null when no anchor exists
    (cpu_only, unknown GPUs).

        Attributes:
            hardware_key (None | str):
            model_family (str):
            runs_in_group (int):
            confidence (Confidence): How much to trust one aggregate: sample size, decode-IQR width, outlier density,
                recency and an overall grade.
            median_prefill_tok_per_sec (float):
            median_decode_tok_per_sec (float):
            hardware (None | str | Unset):
            hw_class (BestResultHwClassType1 | BestResultHwClassType2Type1 | BestResultHwClassType3Type1 | None | Unset):
            gpu (None | str | Unset):
            gpu_count (int | None | Unset):  Default: 1.
            vram_gb (float | None | Unset):
            effective_vram_gb (float | None | Unset): Discrete VRAM, falling back to unified memory
            chip (None | str | Unset):
            unified_memory_gb (float | None | Unset):
            cpu (None | str | Unset):
            example_model (None | str | Unset):
            quantization (None | str | Unset):
            engine (None | str | Unset):
            best_decode_tok_per_sec (float | None | Unset):
            median_prefill_ci_95 (BestResultMedianPrefillCi95 | Unset): 95% percentile bootstrap confidence interval (2,000
                resamples). Overlapping intervals across groups mean they are statistically tied.
            median_prefill_label (None | str | Unset):
            median_decode_ci_95 (BestResultMedianDecodeCi95 | Unset): 95% percentile bootstrap confidence interval (2,000
                resamples). Overlapping intervals across groups mean they are statistically tied.
            median_decode_label (None | str | Unset):
            caveats (list[Caveat] | Unset):
            newest_run_at (datetime.datetime | None | Unset):
            newest_age_days (int | None | Unset):
            staleness (BestResultStalenessType1 | BestResultStalenessType2Type1 | BestResultStalenessType3Type1 | None |
                Unset):
            engine_versions (list[str] | Unset): Engine builds seen in the group (mixed builds → treat deltas with caution)
            major_release_warnings (list[str] | Unset):
            engines (list[str] | Unset): "engine version" tags seen in the group
            engine_version (None | str | Unset): Engine build when the group is single-build; null/absent when mixed
            mixed_engines (bool | Unset): True when the group spans multiple engine builds
            mixed_context_bands (bool | None | Unset): Present (true) only when ?context_band= filtering is off and the
                group mixes bands
            context_bands (BestResultContextBands | Unset): Context-length band mix inside the group — speeds depend on
                context, so a mixed group blends regimes.
            data_quality (BestResultDataQualityType0 | None | Unset): Unit-consistency audit over the group's runs (status
                ok|flagged).
            ttft_seconds (float | Unset): Expected time to first token at the default/requested scenario shape (default
                2048-in / 512-out)
            decode_seconds (float | Unset): Projected decode walltime for the scenario output tokens
            projected_walltime_seconds (float | Unset): Prefill + decode walltime for the scenario shape
            effective_throughput_tok_per_sec (float | Unset): Total tokens / total walltime for the scenario shape
            prefill_share_pct (float | Unset): Share of scenario walltime spent prefilling
            decode_share_pct (float | Unset): Share of scenario walltime spent decoding
            source (None | str | Unset):
            vram_fit (BestResultVramFitType0 | None | Unset): Estimated fit at the requested context (present with ?fitCheck
                or ?contextLength): weights + KV cache vs available memory.
            pricing (BestResultPricingType0 | None | Unset): USD street-price estimate with range, per-GPU breakdown, asOf
                date and eBay/Craigslist verification links; null when no anchor exists.
            power (BestResultPowerType0 | None | Unset): Board power (TDP per card and total), typical whole-rig inference
                wattage and recommended PSU size; null when no anchor exists.
            explain (None | str | Unset): One-sentence human-readable explanation combining VRAM-fit math with the measured
                source — pass-through ready for agent chat pipelines
     """

    hardware_key: None | str
    model_family: str
    runs_in_group: int
    confidence: Confidence
    median_prefill_tok_per_sec: float
    median_decode_tok_per_sec: float
    hardware: None | str | Unset = UNSET
    hw_class: BestResultHwClassType1 | BestResultHwClassType2Type1 | BestResultHwClassType3Type1 | None | Unset = UNSET
    gpu: None | str | Unset = UNSET
    gpu_count: int | None | Unset = 1
    vram_gb: float | None | Unset = UNSET
    effective_vram_gb: float | None | Unset = UNSET
    chip: None | str | Unset = UNSET
    unified_memory_gb: float | None | Unset = UNSET
    cpu: None | str | Unset = UNSET
    example_model: None | str | Unset = UNSET
    quantization: None | str | Unset = UNSET
    engine: None | str | Unset = UNSET
    best_decode_tok_per_sec: float | None | Unset = UNSET
    median_prefill_ci_95: BestResultMedianPrefillCi95 | Unset = UNSET
    median_prefill_label: None | str | Unset = UNSET
    median_decode_ci_95: BestResultMedianDecodeCi95 | Unset = UNSET
    median_decode_label: None | str | Unset = UNSET
    caveats: list[Caveat] | Unset = UNSET
    newest_run_at: datetime.datetime | None | Unset = UNSET
    newest_age_days: int | None | Unset = UNSET
    staleness: BestResultStalenessType1 | BestResultStalenessType2Type1 | BestResultStalenessType3Type1 | None | Unset = UNSET
    engine_versions: list[str] | Unset = UNSET
    major_release_warnings: list[str] | Unset = UNSET
    engines: list[str] | Unset = UNSET
    engine_version: None | str | Unset = UNSET
    mixed_engines: bool | Unset = UNSET
    mixed_context_bands: bool | None | Unset = UNSET
    context_bands: BestResultContextBands | Unset = UNSET
    data_quality: BestResultDataQualityType0 | None | Unset = UNSET
    ttft_seconds: float | Unset = UNSET
    decode_seconds: float | Unset = UNSET
    projected_walltime_seconds: float | Unset = UNSET
    effective_throughput_tok_per_sec: float | Unset = UNSET
    prefill_share_pct: float | Unset = UNSET
    decode_share_pct: float | Unset = UNSET
    source: None | str | Unset = UNSET
    vram_fit: BestResultVramFitType0 | None | Unset = UNSET
    pricing: BestResultPricingType0 | None | Unset = UNSET
    power: BestResultPowerType0 | None | Unset = UNSET
    explain: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.best_result_context_bands import BestResultContextBands
        from ..models.best_result_data_quality_type_0 import BestResultDataQualityType0
        from ..models.best_result_median_decode_ci_95 import BestResultMedianDecodeCi95
        from ..models.best_result_median_prefill_ci_95 import BestResultMedianPrefillCi95
        from ..models.best_result_power_type_0 import BestResultPowerType0
        from ..models.best_result_pricing_type_0 import BestResultPricingType0
        from ..models.best_result_vram_fit_type_0 import BestResultVramFitType0
        from ..models.caveat import Caveat
        from ..models.confidence import Confidence
        hardware_key: None | str
        hardware_key = self.hardware_key

        model_family = self.model_family

        runs_in_group = self.runs_in_group

        confidence = self.confidence.to_dict()

        median_prefill_tok_per_sec = self.median_prefill_tok_per_sec

        median_decode_tok_per_sec = self.median_decode_tok_per_sec

        hardware: None | str | Unset
        if isinstance(self.hardware, Unset):
            hardware = UNSET
        else:
            hardware = self.hardware

        hw_class: None | str | Unset
        if isinstance(self.hw_class, Unset):
            hw_class = UNSET
        elif isinstance(self.hw_class, BestResultHwClassType1):
            hw_class = self.hw_class.value
        elif isinstance(self.hw_class, BestResultHwClassType2Type1):
            hw_class = self.hw_class.value
        elif isinstance(self.hw_class, BestResultHwClassType3Type1):
            hw_class = self.hw_class.value
        else:
            hw_class = self.hw_class

        gpu: None | str | Unset
        if isinstance(self.gpu, Unset):
            gpu = UNSET
        else:
            gpu = self.gpu

        gpu_count: int | None | Unset
        if isinstance(self.gpu_count, Unset):
            gpu_count = UNSET
        else:
            gpu_count = self.gpu_count

        vram_gb: float | None | Unset
        if isinstance(self.vram_gb, Unset):
            vram_gb = UNSET
        else:
            vram_gb = self.vram_gb

        effective_vram_gb: float | None | Unset
        if isinstance(self.effective_vram_gb, Unset):
            effective_vram_gb = UNSET
        else:
            effective_vram_gb = self.effective_vram_gb

        chip: None | str | Unset
        if isinstance(self.chip, Unset):
            chip = UNSET
        else:
            chip = self.chip

        unified_memory_gb: float | None | Unset
        if isinstance(self.unified_memory_gb, Unset):
            unified_memory_gb = UNSET
        else:
            unified_memory_gb = self.unified_memory_gb

        cpu: None | str | Unset
        if isinstance(self.cpu, Unset):
            cpu = UNSET
        else:
            cpu = self.cpu

        example_model: None | str | Unset
        if isinstance(self.example_model, Unset):
            example_model = UNSET
        else:
            example_model = self.example_model

        quantization: None | str | Unset
        if isinstance(self.quantization, Unset):
            quantization = UNSET
        else:
            quantization = self.quantization

        engine: None | str | Unset
        if isinstance(self.engine, Unset):
            engine = UNSET
        else:
            engine = self.engine

        best_decode_tok_per_sec: float | None | Unset
        if isinstance(self.best_decode_tok_per_sec, Unset):
            best_decode_tok_per_sec = UNSET
        else:
            best_decode_tok_per_sec = self.best_decode_tok_per_sec

        median_prefill_ci_95: dict[str, Any] | Unset = UNSET
        if not isinstance(self.median_prefill_ci_95, Unset):
            median_prefill_ci_95 = self.median_prefill_ci_95.to_dict()

        median_prefill_label: None | str | Unset
        if isinstance(self.median_prefill_label, Unset):
            median_prefill_label = UNSET
        else:
            median_prefill_label = self.median_prefill_label

        median_decode_ci_95: dict[str, Any] | Unset = UNSET
        if not isinstance(self.median_decode_ci_95, Unset):
            median_decode_ci_95 = self.median_decode_ci_95.to_dict()

        median_decode_label: None | str | Unset
        if isinstance(self.median_decode_label, Unset):
            median_decode_label = UNSET
        else:
            median_decode_label = self.median_decode_label

        caveats: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.caveats, Unset):
            caveats = []
            for caveats_item_data in self.caveats:
                caveats_item = caveats_item_data.to_dict()
                caveats.append(caveats_item)



        newest_run_at: None | str | Unset
        if isinstance(self.newest_run_at, Unset):
            newest_run_at = UNSET
        elif isinstance(self.newest_run_at, datetime.datetime):
            newest_run_at = self.newest_run_at.isoformat()
        else:
            newest_run_at = self.newest_run_at

        newest_age_days: int | None | Unset
        if isinstance(self.newest_age_days, Unset):
            newest_age_days = UNSET
        else:
            newest_age_days = self.newest_age_days

        staleness: None | str | Unset
        if isinstance(self.staleness, Unset):
            staleness = UNSET
        elif isinstance(self.staleness, BestResultStalenessType1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, BestResultStalenessType2Type1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, BestResultStalenessType3Type1):
            staleness = self.staleness.value
        else:
            staleness = self.staleness

        engine_versions: list[str] | Unset = UNSET
        if not isinstance(self.engine_versions, Unset):
            engine_versions = self.engine_versions



        major_release_warnings: list[str] | Unset = UNSET
        if not isinstance(self.major_release_warnings, Unset):
            major_release_warnings = self.major_release_warnings



        engines: list[str] | Unset = UNSET
        if not isinstance(self.engines, Unset):
            engines = self.engines



        engine_version: None | str | Unset
        if isinstance(self.engine_version, Unset):
            engine_version = UNSET
        else:
            engine_version = self.engine_version

        mixed_engines = self.mixed_engines

        mixed_context_bands: bool | None | Unset
        if isinstance(self.mixed_context_bands, Unset):
            mixed_context_bands = UNSET
        else:
            mixed_context_bands = self.mixed_context_bands

        context_bands: dict[str, Any] | Unset = UNSET
        if not isinstance(self.context_bands, Unset):
            context_bands = self.context_bands.to_dict()

        data_quality: dict[str, Any] | None | Unset
        if isinstance(self.data_quality, Unset):
            data_quality = UNSET
        elif isinstance(self.data_quality, BestResultDataQualityType0):
            data_quality = self.data_quality.to_dict()
        else:
            data_quality = self.data_quality

        ttft_seconds = self.ttft_seconds

        decode_seconds = self.decode_seconds

        projected_walltime_seconds = self.projected_walltime_seconds

        effective_throughput_tok_per_sec = self.effective_throughput_tok_per_sec

        prefill_share_pct = self.prefill_share_pct

        decode_share_pct = self.decode_share_pct

        source: None | str | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        else:
            source = self.source

        vram_fit: dict[str, Any] | None | Unset
        if isinstance(self.vram_fit, Unset):
            vram_fit = UNSET
        elif isinstance(self.vram_fit, BestResultVramFitType0):
            vram_fit = self.vram_fit.to_dict()
        else:
            vram_fit = self.vram_fit

        pricing: dict[str, Any] | None | Unset
        if isinstance(self.pricing, Unset):
            pricing = UNSET
        elif isinstance(self.pricing, BestResultPricingType0):
            pricing = self.pricing.to_dict()
        else:
            pricing = self.pricing

        power: dict[str, Any] | None | Unset
        if isinstance(self.power, Unset):
            power = UNSET
        elif isinstance(self.power, BestResultPowerType0):
            power = self.power.to_dict()
        else:
            power = self.power

        explain: None | str | Unset
        if isinstance(self.explain, Unset):
            explain = UNSET
        else:
            explain = self.explain


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "hardwareKey": hardware_key,
            "modelFamily": model_family,
            "runsInGroup": runs_in_group,
            "confidence": confidence,
            "medianPrefillTokPerSec": median_prefill_tok_per_sec,
            "medianDecodeTokPerSec": median_decode_tok_per_sec,
        })
        if hardware is not UNSET:
            field_dict["hardware"] = hardware
        if hw_class is not UNSET:
            field_dict["hwClass"] = hw_class
        if gpu is not UNSET:
            field_dict["gpu"] = gpu
        if gpu_count is not UNSET:
            field_dict["gpuCount"] = gpu_count
        if vram_gb is not UNSET:
            field_dict["vramGb"] = vram_gb
        if effective_vram_gb is not UNSET:
            field_dict["effectiveVramGb"] = effective_vram_gb
        if chip is not UNSET:
            field_dict["chip"] = chip
        if unified_memory_gb is not UNSET:
            field_dict["unifiedMemoryGb"] = unified_memory_gb
        if cpu is not UNSET:
            field_dict["cpu"] = cpu
        if example_model is not UNSET:
            field_dict["exampleModel"] = example_model
        if quantization is not UNSET:
            field_dict["quantization"] = quantization
        if engine is not UNSET:
            field_dict["engine"] = engine
        if best_decode_tok_per_sec is not UNSET:
            field_dict["bestDecodeTokPerSec"] = best_decode_tok_per_sec
        if median_prefill_ci_95 is not UNSET:
            field_dict["medianPrefillCi95"] = median_prefill_ci_95
        if median_prefill_label is not UNSET:
            field_dict["medianPrefillLabel"] = median_prefill_label
        if median_decode_ci_95 is not UNSET:
            field_dict["medianDecodeCi95"] = median_decode_ci_95
        if median_decode_label is not UNSET:
            field_dict["medianDecodeLabel"] = median_decode_label
        if caveats is not UNSET:
            field_dict["caveats"] = caveats
        if newest_run_at is not UNSET:
            field_dict["newestRunAt"] = newest_run_at
        if newest_age_days is not UNSET:
            field_dict["newestAgeDays"] = newest_age_days
        if staleness is not UNSET:
            field_dict["staleness"] = staleness
        if engine_versions is not UNSET:
            field_dict["engineVersions"] = engine_versions
        if major_release_warnings is not UNSET:
            field_dict["majorReleaseWarnings"] = major_release_warnings
        if engines is not UNSET:
            field_dict["engines"] = engines
        if engine_version is not UNSET:
            field_dict["engineVersion"] = engine_version
        if mixed_engines is not UNSET:
            field_dict["mixedEngines"] = mixed_engines
        if mixed_context_bands is not UNSET:
            field_dict["mixedContextBands"] = mixed_context_bands
        if context_bands is not UNSET:
            field_dict["contextBands"] = context_bands
        if data_quality is not UNSET:
            field_dict["dataQuality"] = data_quality
        if ttft_seconds is not UNSET:
            field_dict["ttftSeconds"] = ttft_seconds
        if decode_seconds is not UNSET:
            field_dict["decodeSeconds"] = decode_seconds
        if projected_walltime_seconds is not UNSET:
            field_dict["projectedWalltimeSeconds"] = projected_walltime_seconds
        if effective_throughput_tok_per_sec is not UNSET:
            field_dict["effectiveThroughputTokPerSec"] = effective_throughput_tok_per_sec
        if prefill_share_pct is not UNSET:
            field_dict["prefillSharePct"] = prefill_share_pct
        if decode_share_pct is not UNSET:
            field_dict["decodeSharePct"] = decode_share_pct
        if source is not UNSET:
            field_dict["source"] = source
        if vram_fit is not UNSET:
            field_dict["vramFit"] = vram_fit
        if pricing is not UNSET:
            field_dict["pricing"] = pricing
        if power is not UNSET:
            field_dict["power"] = power
        if explain is not UNSET:
            field_dict["explain"] = explain

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.best_result_context_bands import BestResultContextBands
        from ..models.best_result_data_quality_type_0 import BestResultDataQualityType0
        from ..models.best_result_median_decode_ci_95 import BestResultMedianDecodeCi95
        from ..models.best_result_median_prefill_ci_95 import BestResultMedianPrefillCi95
        from ..models.best_result_power_type_0 import BestResultPowerType0
        from ..models.best_result_pricing_type_0 import BestResultPricingType0
        from ..models.best_result_vram_fit_type_0 import BestResultVramFitType0
        from ..models.caveat import Caveat
        from ..models.confidence import Confidence
        d = dict(src_dict)
        def _parse_hardware_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        hardware_key = _parse_hardware_key(d.pop("hardwareKey"))


        model_family = d.pop("modelFamily")

        runs_in_group = d.pop("runsInGroup")

        confidence = Confidence.from_dict(d.pop("confidence"))




        median_prefill_tok_per_sec = d.pop("medianPrefillTokPerSec")

        median_decode_tok_per_sec = d.pop("medianDecodeTokPerSec")

        def _parse_hardware(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        hardware = _parse_hardware(d.pop("hardware", UNSET))


        def _parse_hw_class(data: object) -> BestResultHwClassType1 | BestResultHwClassType2Type1 | BestResultHwClassType3Type1 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_1 = BestResultHwClassType1(data)



                return hw_class_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_2_type_1 = BestResultHwClassType2Type1(data)



                return hw_class_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_3_type_1 = BestResultHwClassType3Type1(data)



                return hw_class_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BestResultHwClassType1 | BestResultHwClassType2Type1 | BestResultHwClassType3Type1 | None | Unset, data)

        hw_class = _parse_hw_class(d.pop("hwClass", UNSET))


        def _parse_gpu(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        gpu = _parse_gpu(d.pop("gpu", UNSET))


        def _parse_gpu_count(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        gpu_count = _parse_gpu_count(d.pop("gpuCount", UNSET))


        def _parse_vram_gb(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        vram_gb = _parse_vram_gb(d.pop("vramGb", UNSET))


        def _parse_effective_vram_gb(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        effective_vram_gb = _parse_effective_vram_gb(d.pop("effectiveVramGb", UNSET))


        def _parse_chip(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        chip = _parse_chip(d.pop("chip", UNSET))


        def _parse_unified_memory_gb(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        unified_memory_gb = _parse_unified_memory_gb(d.pop("unifiedMemoryGb", UNSET))


        def _parse_cpu(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        cpu = _parse_cpu(d.pop("cpu", UNSET))


        def _parse_example_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        example_model = _parse_example_model(d.pop("exampleModel", UNSET))


        def _parse_quantization(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        quantization = _parse_quantization(d.pop("quantization", UNSET))


        def _parse_engine(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        engine = _parse_engine(d.pop("engine", UNSET))


        def _parse_best_decode_tok_per_sec(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        best_decode_tok_per_sec = _parse_best_decode_tok_per_sec(d.pop("bestDecodeTokPerSec", UNSET))


        _median_prefill_ci_95 = d.pop("medianPrefillCi95", UNSET)
        median_prefill_ci_95: BestResultMedianPrefillCi95 | Unset
        if isinstance(_median_prefill_ci_95,  Unset):
            median_prefill_ci_95 = UNSET
        else:
            median_prefill_ci_95 = BestResultMedianPrefillCi95.from_dict(_median_prefill_ci_95)




        def _parse_median_prefill_label(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        median_prefill_label = _parse_median_prefill_label(d.pop("medianPrefillLabel", UNSET))


        _median_decode_ci_95 = d.pop("medianDecodeCi95", UNSET)
        median_decode_ci_95: BestResultMedianDecodeCi95 | Unset
        if isinstance(_median_decode_ci_95,  Unset):
            median_decode_ci_95 = UNSET
        else:
            median_decode_ci_95 = BestResultMedianDecodeCi95.from_dict(_median_decode_ci_95)




        def _parse_median_decode_label(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        median_decode_label = _parse_median_decode_label(d.pop("medianDecodeLabel", UNSET))


        _caveats = d.pop("caveats", UNSET)
        caveats: list[Caveat] | Unset = UNSET
        if _caveats is not UNSET:
            caveats = []
            for caveats_item_data in _caveats:
                caveats_item = Caveat.from_dict(caveats_item_data)



                caveats.append(caveats_item)


        def _parse_newest_run_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                newest_run_at_type_0 = datetime.datetime.fromisoformat(data)



                return newest_run_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        newest_run_at = _parse_newest_run_at(d.pop("newestRunAt", UNSET))


        def _parse_newest_age_days(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        newest_age_days = _parse_newest_age_days(d.pop("newestAgeDays", UNSET))


        def _parse_staleness(data: object) -> BestResultStalenessType1 | BestResultStalenessType2Type1 | BestResultStalenessType3Type1 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_1 = BestResultStalenessType1(data)



                return staleness_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_2_type_1 = BestResultStalenessType2Type1(data)



                return staleness_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_3_type_1 = BestResultStalenessType3Type1(data)



                return staleness_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BestResultStalenessType1 | BestResultStalenessType2Type1 | BestResultStalenessType3Type1 | None | Unset, data)

        staleness = _parse_staleness(d.pop("staleness", UNSET))


        engine_versions = cast(list[str], d.pop("engineVersions", UNSET))


        major_release_warnings = cast(list[str], d.pop("majorReleaseWarnings", UNSET))


        engines = cast(list[str], d.pop("engines", UNSET))


        def _parse_engine_version(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        engine_version = _parse_engine_version(d.pop("engineVersion", UNSET))


        mixed_engines = d.pop("mixedEngines", UNSET)

        def _parse_mixed_context_bands(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        mixed_context_bands = _parse_mixed_context_bands(d.pop("mixedContextBands", UNSET))


        _context_bands = d.pop("contextBands", UNSET)
        context_bands: BestResultContextBands | Unset
        if isinstance(_context_bands,  Unset):
            context_bands = UNSET
        else:
            context_bands = BestResultContextBands.from_dict(_context_bands)




        def _parse_data_quality(data: object) -> BestResultDataQualityType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                data_quality_type_0 = BestResultDataQualityType0.from_dict(data)



                return data_quality_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BestResultDataQualityType0 | None | Unset, data)

        data_quality = _parse_data_quality(d.pop("dataQuality", UNSET))


        ttft_seconds = d.pop("ttftSeconds", UNSET)

        decode_seconds = d.pop("decodeSeconds", UNSET)

        projected_walltime_seconds = d.pop("projectedWalltimeSeconds", UNSET)

        effective_throughput_tok_per_sec = d.pop("effectiveThroughputTokPerSec", UNSET)

        prefill_share_pct = d.pop("prefillSharePct", UNSET)

        decode_share_pct = d.pop("decodeSharePct", UNSET)

        def _parse_source(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        source = _parse_source(d.pop("source", UNSET))


        def _parse_vram_fit(data: object) -> BestResultVramFitType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                vram_fit_type_0 = BestResultVramFitType0.from_dict(data)



                return vram_fit_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BestResultVramFitType0 | None | Unset, data)

        vram_fit = _parse_vram_fit(d.pop("vramFit", UNSET))


        def _parse_pricing(data: object) -> BestResultPricingType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                pricing_type_0 = BestResultPricingType0.from_dict(data)



                return pricing_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BestResultPricingType0 | None | Unset, data)

        pricing = _parse_pricing(d.pop("pricing", UNSET))


        def _parse_power(data: object) -> BestResultPowerType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                power_type_0 = BestResultPowerType0.from_dict(data)



                return power_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BestResultPowerType0 | None | Unset, data)

        power = _parse_power(d.pop("power", UNSET))


        def _parse_explain(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        explain = _parse_explain(d.pop("explain", UNSET))


        best_result = cls(
            hardware_key=hardware_key,
            model_family=model_family,
            runs_in_group=runs_in_group,
            confidence=confidence,
            median_prefill_tok_per_sec=median_prefill_tok_per_sec,
            median_decode_tok_per_sec=median_decode_tok_per_sec,
            hardware=hardware,
            hw_class=hw_class,
            gpu=gpu,
            gpu_count=gpu_count,
            vram_gb=vram_gb,
            effective_vram_gb=effective_vram_gb,
            chip=chip,
            unified_memory_gb=unified_memory_gb,
            cpu=cpu,
            example_model=example_model,
            quantization=quantization,
            engine=engine,
            best_decode_tok_per_sec=best_decode_tok_per_sec,
            median_prefill_ci_95=median_prefill_ci_95,
            median_prefill_label=median_prefill_label,
            median_decode_ci_95=median_decode_ci_95,
            median_decode_label=median_decode_label,
            caveats=caveats,
            newest_run_at=newest_run_at,
            newest_age_days=newest_age_days,
            staleness=staleness,
            engine_versions=engine_versions,
            major_release_warnings=major_release_warnings,
            engines=engines,
            engine_version=engine_version,
            mixed_engines=mixed_engines,
            mixed_context_bands=mixed_context_bands,
            context_bands=context_bands,
            data_quality=data_quality,
            ttft_seconds=ttft_seconds,
            decode_seconds=decode_seconds,
            projected_walltime_seconds=projected_walltime_seconds,
            effective_throughput_tok_per_sec=effective_throughput_tok_per_sec,
            prefill_share_pct=prefill_share_pct,
            decode_share_pct=decode_share_pct,
            source=source,
            vram_fit=vram_fit,
            pricing=pricing,
            power=power,
            explain=explain,
        )


        best_result.additional_properties = d
        return best_result

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
