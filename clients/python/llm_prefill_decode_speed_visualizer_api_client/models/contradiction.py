from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.contradiction_kind import ContradictionKind
from ..models.contradiction_metric import ContradictionMetric
from ..types import UNSET, Unset






T = TypeVar("T", bound="Contradiction")



@_attrs_define
class Contradiction:
    """ A multi-GPU rig whose numbers contradict the single-GPU baseline on the same model/quant — likely a misconfigured
    run.

        Attributes:
            kind (ContradictionKind):
            metric (ContradictionMetric):
            vs (str | Unset): Rig label, e.g. "2x RTX 4090"
            gpu_count (int | Unset):
            single_tok_per_sec (float | Unset):
            multi_tok_per_sec (float | Unset):
            delta_pct (float | Unset):
            per_gpu_scaling_pct (float | Unset):
            note (str | Unset):
     """

    kind: ContradictionKind
    metric: ContradictionMetric
    vs: str | Unset = UNSET
    gpu_count: int | Unset = UNSET
    single_tok_per_sec: float | Unset = UNSET
    multi_tok_per_sec: float | Unset = UNSET
    delta_pct: float | Unset = UNSET
    per_gpu_scaling_pct: float | Unset = UNSET
    note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        kind = self.kind.value

        metric = self.metric.value

        vs = self.vs

        gpu_count = self.gpu_count

        single_tok_per_sec = self.single_tok_per_sec

        multi_tok_per_sec = self.multi_tok_per_sec

        delta_pct = self.delta_pct

        per_gpu_scaling_pct = self.per_gpu_scaling_pct

        note = self.note


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "kind": kind,
            "metric": metric,
        })
        if vs is not UNSET:
            field_dict["vs"] = vs
        if gpu_count is not UNSET:
            field_dict["gpuCount"] = gpu_count
        if single_tok_per_sec is not UNSET:
            field_dict["singleTokPerSec"] = single_tok_per_sec
        if multi_tok_per_sec is not UNSET:
            field_dict["multiTokPerSec"] = multi_tok_per_sec
        if delta_pct is not UNSET:
            field_dict["deltaPct"] = delta_pct
        if per_gpu_scaling_pct is not UNSET:
            field_dict["perGpuScalingPct"] = per_gpu_scaling_pct
        if note is not UNSET:
            field_dict["note"] = note

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = ContradictionKind(d.pop("kind"))




        metric = ContradictionMetric(d.pop("metric"))




        vs = d.pop("vs", UNSET)

        gpu_count = d.pop("gpuCount", UNSET)

        single_tok_per_sec = d.pop("singleTokPerSec", UNSET)

        multi_tok_per_sec = d.pop("multiTokPerSec", UNSET)

        delta_pct = d.pop("deltaPct", UNSET)

        per_gpu_scaling_pct = d.pop("perGpuScalingPct", UNSET)

        note = d.pop("note", UNSET)

        contradiction = cls(
            kind=kind,
            metric=metric,
            vs=vs,
            gpu_count=gpu_count,
            single_tok_per_sec=single_tok_per_sec,
            multi_tok_per_sec=multi_tok_per_sec,
            delta_pct=delta_pct,
            per_gpu_scaling_pct=per_gpu_scaling_pct,
            note=note,
        )


        contradiction.additional_properties = d
        return contradiction

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
