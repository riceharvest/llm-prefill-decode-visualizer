from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.compute_result_inputs import ComputeResultInputs
  from ..models.compute_result_warnings_item import ComputeResultWarningsItem





T = TypeVar("T", bound="ComputeResult")



@_attrs_define
class ComputeResult:
    """ Computed inference metrics. Every successful result carries a deterministic `id` (calc_<hash> of the resolved
    inputs) replayable via /api/calc/{id}, plus a non-blocking `warnings` array flagging physically implausible inputs.

        Attributes:
            inputs (ComputeResultInputs): Resolved input parameters (defaults filled in)
            warnings (list[ComputeResultWarningsItem]): Implausibility warnings (empty when inputs are plausible); never
                affect the math or HTTP status.
            id (str | Unset): Deterministic content hash of the resolved request
            ttft_seconds (float | Unset): Time to first token (singleTurn/batched/agentic/kvCache/cost modes)
            tpot_ms (float | Unset): Time per output token in ms
            decode_seconds (float | Unset):
            total_walltime_seconds (float | Unset):
            effective_throughput_tok_per_sec (float | Unset):
            prefill_share_pct (float | Unset):
            decode_share_pct (float | Unset):
     """

    inputs: ComputeResultInputs
    warnings: list[ComputeResultWarningsItem]
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
        from ..models.compute_result_inputs import ComputeResultInputs
        from ..models.compute_result_warnings_item import ComputeResultWarningsItem
        inputs = self.inputs.to_dict()

        warnings = []
        for warnings_item_data in self.warnings:
            warnings_item = warnings_item_data.to_dict()
            warnings.append(warnings_item)



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
        field_dict.update({
            "inputs": inputs,
            "warnings": warnings,
        })
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
        from ..models.compute_result_inputs import ComputeResultInputs
        from ..models.compute_result_warnings_item import ComputeResultWarningsItem
        d = dict(src_dict)
        inputs = ComputeResultInputs.from_dict(d.pop("inputs"))




        warnings = []
        _warnings = d.pop("warnings")
        for warnings_item_data in (_warnings):
            warnings_item = ComputeResultWarningsItem.from_dict(warnings_item_data)



            warnings.append(warnings_item)


        id = d.pop("id", UNSET)

        ttft_seconds = d.pop("ttftSeconds", UNSET)

        tpot_ms = d.pop("tpotMs", UNSET)

        decode_seconds = d.pop("decodeSeconds", UNSET)

        total_walltime_seconds = d.pop("totalWalltimeSeconds", UNSET)

        effective_throughput_tok_per_sec = d.pop("effectiveThroughputTokPerSec", UNSET)

        prefill_share_pct = d.pop("prefillSharePct", UNSET)

        decode_share_pct = d.pop("decodeSharePct", UNSET)

        compute_result = cls(
            inputs=inputs,
            warnings=warnings,
            id=id,
            ttft_seconds=ttft_seconds,
            tpot_ms=tpot_ms,
            decode_seconds=decode_seconds,
            total_walltime_seconds=total_walltime_seconds,
            effective_throughput_tok_per_sec=effective_throughput_tok_per_sec,
            prefill_share_pct=prefill_share_pct,
            decode_share_pct=decode_share_pct,
        )


        compute_result.additional_properties = d
        return compute_result

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
