from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.benchmark_group_data_quality_type_0_status import BenchmarkGroupDataQualityType0Status
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.benchmark_group_data_quality_type_0_flag_counts import BenchmarkGroupDataQualityType0FlagCounts
    from ..models.benchmark_group_data_quality_type_0_flagged_item import BenchmarkGroupDataQualityType0FlaggedItem


T = TypeVar("T", bound="BenchmarkGroupDataQualityType0")


@_attrs_define
class BenchmarkGroupDataQualityType0:
    """Unit-consistency audit over the group's runs (status ok|flagged).

    Attributes:
        status (BenchmarkGroupDataQualityType0Status | Unset):
        runs_audited (int | Unset):
        flagged_runs (int | Unset):
        flag_counts (BenchmarkGroupDataQualityType0FlagCounts | Unset):
        flagged (list[BenchmarkGroupDataQualityType0FlaggedItem] | Unset):
    """

    status: BenchmarkGroupDataQualityType0Status | Unset = UNSET
    runs_audited: int | Unset = UNSET
    flagged_runs: int | Unset = UNSET
    flag_counts: BenchmarkGroupDataQualityType0FlagCounts | Unset = UNSET
    flagged: list[BenchmarkGroupDataQualityType0FlaggedItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        runs_audited = self.runs_audited

        flagged_runs = self.flagged_runs

        flag_counts: dict[str, Any] | Unset = UNSET
        if not isinstance(self.flag_counts, Unset):
            flag_counts = self.flag_counts.to_dict()

        flagged: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.flagged, Unset):
            flagged = []
            for flagged_item_data in self.flagged:
                flagged_item = flagged_item_data.to_dict()
                flagged.append(flagged_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if status is not UNSET:
            field_dict["status"] = status
        if runs_audited is not UNSET:
            field_dict["runsAudited"] = runs_audited
        if flagged_runs is not UNSET:
            field_dict["flaggedRuns"] = flagged_runs
        if flag_counts is not UNSET:
            field_dict["flagCounts"] = flag_counts
        if flagged is not UNSET:
            field_dict["flagged"] = flagged

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.benchmark_group_data_quality_type_0_flag_counts import BenchmarkGroupDataQualityType0FlagCounts
        from ..models.benchmark_group_data_quality_type_0_flagged_item import BenchmarkGroupDataQualityType0FlaggedItem

        d = dict(src_dict)
        _status = d.pop("status", UNSET)
        status: BenchmarkGroupDataQualityType0Status | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = BenchmarkGroupDataQualityType0Status(_status)

        runs_audited = d.pop("runsAudited", UNSET)

        flagged_runs = d.pop("flaggedRuns", UNSET)

        _flag_counts = d.pop("flagCounts", UNSET)
        flag_counts: BenchmarkGroupDataQualityType0FlagCounts | Unset
        if isinstance(_flag_counts, Unset):
            flag_counts = UNSET
        else:
            flag_counts = BenchmarkGroupDataQualityType0FlagCounts.from_dict(_flag_counts)

        _flagged = d.pop("flagged", UNSET)
        flagged: list[BenchmarkGroupDataQualityType0FlaggedItem] | Unset = UNSET
        if _flagged is not UNSET:
            flagged = []
            for flagged_item_data in _flagged:
                flagged_item = BenchmarkGroupDataQualityType0FlaggedItem.from_dict(flagged_item_data)

                flagged.append(flagged_item)

        benchmark_group_data_quality_type_0 = cls(
            status=status,
            runs_audited=runs_audited,
            flagged_runs=flagged_runs,
            flag_counts=flag_counts,
            flagged=flagged,
        )

        benchmark_group_data_quality_type_0.additional_properties = d
        return benchmark_group_data_quality_type_0

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
