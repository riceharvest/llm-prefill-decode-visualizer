from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.benchmark_group_list_envelope_unit_audit_flag_counts import BenchmarkGroupListEnvelopeUnitAuditFlagCounts





T = TypeVar("T", bound="BenchmarkGroupListEnvelopeUnitAudit")



@_attrs_define
class BenchmarkGroupListEnvelopeUnitAudit:
    """ Unit-consistency audit across all matching runs.

        Attributes:
            runs_audited (int | Unset):
            flagged_runs (int | Unset):
            flag_counts (BenchmarkGroupListEnvelopeUnitAuditFlagCounts | Unset):
            note (str | Unset):
     """

    runs_audited: int | Unset = UNSET
    flagged_runs: int | Unset = UNSET
    flag_counts: BenchmarkGroupListEnvelopeUnitAuditFlagCounts | Unset = UNSET
    note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.benchmark_group_list_envelope_unit_audit_flag_counts import BenchmarkGroupListEnvelopeUnitAuditFlagCounts
        runs_audited = self.runs_audited

        flagged_runs = self.flagged_runs

        flag_counts: dict[str, Any] | Unset = UNSET
        if not isinstance(self.flag_counts, Unset):
            flag_counts = self.flag_counts.to_dict()

        note = self.note


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if runs_audited is not UNSET:
            field_dict["runsAudited"] = runs_audited
        if flagged_runs is not UNSET:
            field_dict["flaggedRuns"] = flagged_runs
        if flag_counts is not UNSET:
            field_dict["flagCounts"] = flag_counts
        if note is not UNSET:
            field_dict["note"] = note

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.benchmark_group_list_envelope_unit_audit_flag_counts import BenchmarkGroupListEnvelopeUnitAuditFlagCounts
        d = dict(src_dict)
        runs_audited = d.pop("runsAudited", UNSET)

        flagged_runs = d.pop("flaggedRuns", UNSET)

        _flag_counts = d.pop("flagCounts", UNSET)
        flag_counts: BenchmarkGroupListEnvelopeUnitAuditFlagCounts | Unset
        if isinstance(_flag_counts,  Unset):
            flag_counts = UNSET
        else:
            flag_counts = BenchmarkGroupListEnvelopeUnitAuditFlagCounts.from_dict(_flag_counts)




        note = d.pop("note", UNSET)

        benchmark_group_list_envelope_unit_audit = cls(
            runs_audited=runs_audited,
            flagged_runs=flagged_runs,
            flag_counts=flag_counts,
            note=note,
        )


        benchmark_group_list_envelope_unit_audit.additional_properties = d
        return benchmark_group_list_envelope_unit_audit

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
