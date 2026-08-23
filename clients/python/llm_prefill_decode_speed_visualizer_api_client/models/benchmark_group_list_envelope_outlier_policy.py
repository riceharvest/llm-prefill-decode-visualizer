from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset






T = TypeVar("T", bound="BenchmarkGroupListEnvelopeOutlierPolicy")



@_attrs_define
class BenchmarkGroupListEnvelopeOutlierPolicy:
    """ How outlier runs are fenced and whether they are included in stats.

        Attributes:
            threshold_iqrs (float | Unset):
            include_outliers (bool | Unset):
            note (str | Unset):
     """

    threshold_iqrs: float | Unset = UNSET
    include_outliers: bool | Unset = UNSET
    note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        threshold_iqrs = self.threshold_iqrs

        include_outliers = self.include_outliers

        note = self.note


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if threshold_iqrs is not UNSET:
            field_dict["thresholdIqrs"] = threshold_iqrs
        if include_outliers is not UNSET:
            field_dict["includeOutliers"] = include_outliers
        if note is not UNSET:
            field_dict["note"] = note

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        threshold_iqrs = d.pop("thresholdIqrs", UNSET)

        include_outliers = d.pop("includeOutliers", UNSET)

        note = d.pop("note", UNSET)

        benchmark_group_list_envelope_outlier_policy = cls(
            threshold_iqrs=threshold_iqrs,
            include_outliers=include_outliers,
            note=note,
        )


        benchmark_group_list_envelope_outlier_policy.additional_properties = d
        return benchmark_group_list_envelope_outlier_policy

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
