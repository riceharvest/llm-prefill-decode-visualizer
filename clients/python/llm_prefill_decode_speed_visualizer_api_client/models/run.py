from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.run_context_band_type_1 import RunContextBandType1
from ..models.run_context_band_type_2_type_1 import RunContextBandType2Type1
from ..models.run_context_band_type_3_type_1 import RunContextBandType3Type1
from ..models.run_hw_class_type_1 import RunHwClassType1
from ..models.run_hw_class_type_2_type_1 import RunHwClassType2Type1
from ..models.run_hw_class_type_3_type_1 import RunHwClassType3Type1
from ..models.run_staleness_type_1 import RunStalenessType1
from ..models.run_staleness_type_2_type_1 import RunStalenessType2Type1
from ..models.run_staleness_type_3_type_1 import RunStalenessType3Type1
from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="Run")



@_attrs_define
class Run:
    """ Raw comparable community run, flattened and model-normalized (modelFamily collapses repo/quant variants of the same
    base model). Single-stream runs only.

        Attributes:
            run_id (int): Stable upstream run id (also used as pagination tiebreak)
            model_family (str): Normalized base-model family, e.g. qwen3.6-27b
            prefill_tok_per_sec (int): Measured prompt-processing speed (tok/s)
            decode_tok_per_sec (int): Measured single-stream decode speed (tok/s)
            created_at (datetime.datetime | None | Unset):
            model_id (None | str | Unset): Hugging Face repo id when known
            model_name (None | str | Unset): Upstream display name
            params_b (float | None | Unset): Parameter count in billions
            hardware_key (None | str | Unset): Normalized rig key, e.g. rtx4090
            hardware (None | str | Unset): Human-readable rig label
            hw_class (None | RunHwClassType1 | RunHwClassType2Type1 | RunHwClassType3Type1 | Unset):
            gpu (None | str | Unset):
            gpu_count (int | None | Unset):  Default: 1.
            vram_gb (float | None | Unset):
            chip (None | str | Unset):
            unified_memory_gb (float | None | Unset):
            cpu (None | str | Unset):
            engine (None | str | Unset):  Example: llama.cpp.
            engine_version (None | str | Unset):
            quantization (None | str | Unset):  Example: q4_k_m.
            prompt_tokens (int | None | Unset):
            output_tokens (int | None | Unset):
            context_length (int | None | Unset):
            context_band (None | RunContextBandType1 | RunContextBandType2Type1 | RunContextBandType3Type1 | Unset):
                Context-length bucket; null when the run reports no usable contextLength
            age_days (int | None | Unset): Days since measurement (null when undated)
            staleness (None | RunStalenessType1 | RunStalenessType2Type1 | RunStalenessType3Type1 | Unset): fresh <90d,
                aging <180d, stale otherwise, unknown when undated
            source (None | str | Unset): Link to the upstream run page
     """

    run_id: int
    model_family: str
    prefill_tok_per_sec: int
    decode_tok_per_sec: int
    created_at: datetime.datetime | None | Unset = UNSET
    model_id: None | str | Unset = UNSET
    model_name: None | str | Unset = UNSET
    params_b: float | None | Unset = UNSET
    hardware_key: None | str | Unset = UNSET
    hardware: None | str | Unset = UNSET
    hw_class: None | RunHwClassType1 | RunHwClassType2Type1 | RunHwClassType3Type1 | Unset = UNSET
    gpu: None | str | Unset = UNSET
    gpu_count: int | None | Unset = 1
    vram_gb: float | None | Unset = UNSET
    chip: None | str | Unset = UNSET
    unified_memory_gb: float | None | Unset = UNSET
    cpu: None | str | Unset = UNSET
    engine: None | str | Unset = UNSET
    engine_version: None | str | Unset = UNSET
    quantization: None | str | Unset = UNSET
    prompt_tokens: int | None | Unset = UNSET
    output_tokens: int | None | Unset = UNSET
    context_length: int | None | Unset = UNSET
    context_band: None | RunContextBandType1 | RunContextBandType2Type1 | RunContextBandType3Type1 | Unset = UNSET
    age_days: int | None | Unset = UNSET
    staleness: None | RunStalenessType1 | RunStalenessType2Type1 | RunStalenessType3Type1 | Unset = UNSET
    source: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        model_family = self.model_family

        prefill_tok_per_sec = self.prefill_tok_per_sec

        decode_tok_per_sec = self.decode_tok_per_sec

        created_at: None | str | Unset
        if isinstance(self.created_at, Unset):
            created_at = UNSET
        elif isinstance(self.created_at, datetime.datetime):
            created_at = self.created_at.isoformat()
        else:
            created_at = self.created_at

        model_id: None | str | Unset
        if isinstance(self.model_id, Unset):
            model_id = UNSET
        else:
            model_id = self.model_id

        model_name: None | str | Unset
        if isinstance(self.model_name, Unset):
            model_name = UNSET
        else:
            model_name = self.model_name

        params_b: float | None | Unset
        if isinstance(self.params_b, Unset):
            params_b = UNSET
        else:
            params_b = self.params_b

        hardware_key: None | str | Unset
        if isinstance(self.hardware_key, Unset):
            hardware_key = UNSET
        else:
            hardware_key = self.hardware_key

        hardware: None | str | Unset
        if isinstance(self.hardware, Unset):
            hardware = UNSET
        else:
            hardware = self.hardware

        hw_class: None | str | Unset
        if isinstance(self.hw_class, Unset):
            hw_class = UNSET
        elif isinstance(self.hw_class, RunHwClassType1):
            hw_class = self.hw_class.value
        elif isinstance(self.hw_class, RunHwClassType2Type1):
            hw_class = self.hw_class.value
        elif isinstance(self.hw_class, RunHwClassType3Type1):
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

        engine: None | str | Unset
        if isinstance(self.engine, Unset):
            engine = UNSET
        else:
            engine = self.engine

        engine_version: None | str | Unset
        if isinstance(self.engine_version, Unset):
            engine_version = UNSET
        else:
            engine_version = self.engine_version

        quantization: None | str | Unset
        if isinstance(self.quantization, Unset):
            quantization = UNSET
        else:
            quantization = self.quantization

        prompt_tokens: int | None | Unset
        if isinstance(self.prompt_tokens, Unset):
            prompt_tokens = UNSET
        else:
            prompt_tokens = self.prompt_tokens

        output_tokens: int | None | Unset
        if isinstance(self.output_tokens, Unset):
            output_tokens = UNSET
        else:
            output_tokens = self.output_tokens

        context_length: int | None | Unset
        if isinstance(self.context_length, Unset):
            context_length = UNSET
        else:
            context_length = self.context_length

        context_band: None | str | Unset
        if isinstance(self.context_band, Unset):
            context_band = UNSET
        elif isinstance(self.context_band, RunContextBandType1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, RunContextBandType2Type1):
            context_band = self.context_band.value
        elif isinstance(self.context_band, RunContextBandType3Type1):
            context_band = self.context_band.value
        else:
            context_band = self.context_band

        age_days: int | None | Unset
        if isinstance(self.age_days, Unset):
            age_days = UNSET
        else:
            age_days = self.age_days

        staleness: None | str | Unset
        if isinstance(self.staleness, Unset):
            staleness = UNSET
        elif isinstance(self.staleness, RunStalenessType1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, RunStalenessType2Type1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, RunStalenessType3Type1):
            staleness = self.staleness.value
        else:
            staleness = self.staleness

        source: None | str | Unset
        if isinstance(self.source, Unset):
            source = UNSET
        else:
            source = self.source


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "runId": run_id,
            "modelFamily": model_family,
            "prefillTokPerSec": prefill_tok_per_sec,
            "decodeTokPerSec": decode_tok_per_sec,
        })
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if model_id is not UNSET:
            field_dict["modelId"] = model_id
        if model_name is not UNSET:
            field_dict["modelName"] = model_name
        if params_b is not UNSET:
            field_dict["paramsB"] = params_b
        if hardware_key is not UNSET:
            field_dict["hardwareKey"] = hardware_key
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
        if chip is not UNSET:
            field_dict["chip"] = chip
        if unified_memory_gb is not UNSET:
            field_dict["unifiedMemoryGb"] = unified_memory_gb
        if cpu is not UNSET:
            field_dict["cpu"] = cpu
        if engine is not UNSET:
            field_dict["engine"] = engine
        if engine_version is not UNSET:
            field_dict["engineVersion"] = engine_version
        if quantization is not UNSET:
            field_dict["quantization"] = quantization
        if prompt_tokens is not UNSET:
            field_dict["promptTokens"] = prompt_tokens
        if output_tokens is not UNSET:
            field_dict["outputTokens"] = output_tokens
        if context_length is not UNSET:
            field_dict["contextLength"] = context_length
        if context_band is not UNSET:
            field_dict["contextBand"] = context_band
        if age_days is not UNSET:
            field_dict["ageDays"] = age_days
        if staleness is not UNSET:
            field_dict["staleness"] = staleness
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        run_id = d.pop("runId")

        model_family = d.pop("modelFamily")

        prefill_tok_per_sec = d.pop("prefillTokPerSec")

        decode_tok_per_sec = d.pop("decodeTokPerSec")

        def _parse_created_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                created_at_type_0 = datetime.datetime.fromisoformat(data)



                return created_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        created_at = _parse_created_at(d.pop("createdAt", UNSET))


        def _parse_model_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model_id = _parse_model_id(d.pop("modelId", UNSET))


        def _parse_model_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model_name = _parse_model_name(d.pop("modelName", UNSET))


        def _parse_params_b(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        params_b = _parse_params_b(d.pop("paramsB", UNSET))


        def _parse_hardware_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        hardware_key = _parse_hardware_key(d.pop("hardwareKey", UNSET))


        def _parse_hardware(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        hardware = _parse_hardware(d.pop("hardware", UNSET))


        def _parse_hw_class(data: object) -> None | RunHwClassType1 | RunHwClassType2Type1 | RunHwClassType3Type1 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_1 = RunHwClassType1(data)



                return hw_class_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_2_type_1 = RunHwClassType2Type1(data)



                return hw_class_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                hw_class_type_3_type_1 = RunHwClassType3Type1(data)



                return hw_class_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | RunHwClassType1 | RunHwClassType2Type1 | RunHwClassType3Type1 | Unset, data)

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


        def _parse_engine(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        engine = _parse_engine(d.pop("engine", UNSET))


        def _parse_engine_version(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        engine_version = _parse_engine_version(d.pop("engineVersion", UNSET))


        def _parse_quantization(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        quantization = _parse_quantization(d.pop("quantization", UNSET))


        def _parse_prompt_tokens(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        prompt_tokens = _parse_prompt_tokens(d.pop("promptTokens", UNSET))


        def _parse_output_tokens(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        output_tokens = _parse_output_tokens(d.pop("outputTokens", UNSET))


        def _parse_context_length(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        context_length = _parse_context_length(d.pop("contextLength", UNSET))


        def _parse_context_band(data: object) -> None | RunContextBandType1 | RunContextBandType2Type1 | RunContextBandType3Type1 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_1 = RunContextBandType1(data)



                return context_band_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_2_type_1 = RunContextBandType2Type1(data)



                return context_band_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                context_band_type_3_type_1 = RunContextBandType3Type1(data)



                return context_band_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | RunContextBandType1 | RunContextBandType2Type1 | RunContextBandType3Type1 | Unset, data)

        context_band = _parse_context_band(d.pop("contextBand", UNSET))


        def _parse_age_days(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        age_days = _parse_age_days(d.pop("ageDays", UNSET))


        def _parse_staleness(data: object) -> None | RunStalenessType1 | RunStalenessType2Type1 | RunStalenessType3Type1 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_1 = RunStalenessType1(data)



                return staleness_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_2_type_1 = RunStalenessType2Type1(data)



                return staleness_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_3_type_1 = RunStalenessType3Type1(data)



                return staleness_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | RunStalenessType1 | RunStalenessType2Type1 | RunStalenessType3Type1 | Unset, data)

        staleness = _parse_staleness(d.pop("staleness", UNSET))


        def _parse_source(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        source = _parse_source(d.pop("source", UNSET))


        run = cls(
            run_id=run_id,
            model_family=model_family,
            prefill_tok_per_sec=prefill_tok_per_sec,
            decode_tok_per_sec=decode_tok_per_sec,
            created_at=created_at,
            model_id=model_id,
            model_name=model_name,
            params_b=params_b,
            hardware_key=hardware_key,
            hardware=hardware,
            hw_class=hw_class,
            gpu=gpu,
            gpu_count=gpu_count,
            vram_gb=vram_gb,
            chip=chip,
            unified_memory_gb=unified_memory_gb,
            cpu=cpu,
            engine=engine,
            engine_version=engine_version,
            quantization=quantization,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            context_length=context_length,
            context_band=context_band,
            age_days=age_days,
            staleness=staleness,
            source=source,
        )


        run.additional_properties = d
        return run

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
