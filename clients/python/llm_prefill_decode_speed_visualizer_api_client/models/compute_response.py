from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.compute_response_inputs import ComputeResponseInputs
    from ..models.compute_response_warnings_item import ComputeResponseWarningsItem


T = TypeVar("T", bound="ComputeResponse")


@_attrs_define
class ComputeResponse:
    """Computed inference metrics plus the standard envelope stamp.

    Attributes:
        inputs (ComputeResponseInputs): Resolved input parameters (defaults filled in)
        warnings (list[ComputeResponseWarningsItem]): Implausibility warnings (empty when inputs are plausible); never
            affect the math or HTTP status.
        schema_version (Literal['1']):
        id (str | Unset): Deterministic content hash of the resolved request
        ttft_seconds (float | Unset): Time to first token (singleTurn/batched/agentic/kvCache/cost modes)
        tpot_ms (float | Unset): Time per output token in ms
        decode_seconds (float | Unset):
        total_walltime_seconds (float | Unset):
        effective_throughput_tok_per_sec (float | Unset):
        prefill_share_pct (float | Unset):
        decode_share_pct (float | Unset):
    """

    inputs: ComputeResponseInputs
    warnings: list[ComputeResponseWarningsItem]
    schema_version: Literal["1"]
    id: str | Unset = UNSET
    ttft_seconds: float | Unset = UNSET
    tpot_ms: float | Unset = UNSET
    decode_seconds: float | Unset = UNSET
    total_walltime_seconds: float | Unset = UNSET
    effective_throughput_tok_per_sec: float | Unset = UNSET
    prefill_share_pct: float | Unset = UNSET
    decode_share_pct: float | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        inputs = self.inputs.to_dict()

        warnings = []
        for warnings_item_data in self.warnings:
            warnings_item = warnings_item_data.to_dict()
            warnings.append(warnings_item)

        schema_version = self.schema_version

        id = self.id

        ttft_seconds = self.ttft_seconds

        tpot_ms = self.tpot_ms

        decode_seconds = self.decode_seconds

        total_walltime_seconds = self.total_walltime_seconds

        effective_throughput_tok_per_sec = self.effective_throughput_tok_per_sec

        prefill_share_pct = self.prefill_share_pct

        decode_share_pct = self.decode_share_pct

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "inputs": inputs,
                "warnings": warnings,
                "schema_version": schema_version,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if ttft_seconds is not UNSET:
            field_dict["ttftSeconds"] = ttft_seconds
        if tpot_ms is not UNSET:
            field_dict["tpotMs"] = tpot_ms
        if decode_seconds is not UNSET:
            field_dict["decodeSeconds"] = decode_seconds
        if total_walltime_seconds is not UNSET:
            field_dict["totalWalltimeSeconds"] = total_walltime_seconds
        if effective_throughput_tok_per_sec is not UNSET:
            field_dict["effectiveThroughputTokPerSec"] = effective_throughput_tok_per_sec
        if prefill_share_pct is not UNSET:
            field_dict["prefillSharePct"] = prefill_share_pct
        if decode_share_pct is not UNSET:
            field_dict["decodeSharePct"] = decode_share_pct

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.compute_response_inputs import ComputeResponseInputs
        from ..models.compute_response_warnings_item import ComputeResponseWarningsItem

        d = dict(src_dict)
        inputs = ComputeResponseInputs.from_dict(d.pop("inputs"))

        warnings = []
        _warnings = d.pop("warnings")
        for warnings_item_data in _warnings:
            warnings_item = ComputeResponseWarningsItem.from_dict(warnings_item_data)

            warnings.append(warnings_item)

        schema_version = cast(Literal["1"], d.pop("schema_version"))
        if schema_version != "1":
            raise ValueError(f"schema_version must match const '1', got '{schema_version}'")

        id = d.pop("id", UNSET)

        ttft_seconds = d.pop("ttftSeconds", UNSET)

        tpot_ms = d.pop("tpotMs", UNSET)

        decode_seconds = d.pop("decodeSeconds", UNSET)

        total_walltime_seconds = d.pop("totalWalltimeSeconds", UNSET)

        effective_throughput_tok_per_sec = d.pop("effectiveThroughputTokPerSec", UNSET)

        prefill_share_pct = d.pop("prefillSharePct", UNSET)

        decode_share_pct = d.pop("decodeSharePct", UNSET)

        compute_response = cls(
            inputs=inputs,
            warnings=warnings,
            schema_version=schema_version,
            id=id,
            ttft_seconds=ttft_seconds,
            tpot_ms=tpot_ms,
            decode_seconds=decode_seconds,
            total_walltime_seconds=total_walltime_seconds,
            effective_throughput_tok_per_sec=effective_throughput_tok_per_sec,
            prefill_share_pct=prefill_share_pct,
            decode_share_pct=decode_share_pct,
        )

        compute_response.additional_properties = d
        return compute_response

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
