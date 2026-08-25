from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.benchmark_group_context_bands_bands_item import BenchmarkGroupContextBandsBandsItem


T = TypeVar("T", bound="BenchmarkGroupContextBands")


@_attrs_define
class BenchmarkGroupContextBands:
    """Context-length band mix inside the group — speeds depend on context, so a mixed group blends regimes.

    Attributes:
        bands (list[BenchmarkGroupContextBandsBandsItem] | Unset):
        unknown_runs (int | Unset): Runs reporting no usable contextLength
        distinct_bands (int | Unset):
        mixed (bool | Unset):
    """

    bands: list[BenchmarkGroupContextBandsBandsItem] | Unset = UNSET
    unknown_runs: int | Unset = UNSET
    distinct_bands: int | Unset = UNSET
    mixed: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        bands: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.bands, Unset):
            bands = []
            for bands_item_data in self.bands:
                bands_item = bands_item_data.to_dict()
                bands.append(bands_item)

        unknown_runs = self.unknown_runs

        distinct_bands = self.distinct_bands

        mixed = self.mixed

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if bands is not UNSET:
            field_dict["bands"] = bands
        if unknown_runs is not UNSET:
            field_dict["unknownRuns"] = unknown_runs
        if distinct_bands is not UNSET:
            field_dict["distinctBands"] = distinct_bands
        if mixed is not UNSET:
            field_dict["mixed"] = mixed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.benchmark_group_context_bands_bands_item import BenchmarkGroupContextBandsBandsItem

        d = dict(src_dict)
        _bands = d.pop("bands", UNSET)
        bands: list[BenchmarkGroupContextBandsBandsItem] | Unset = UNSET
        if _bands is not UNSET:
            bands = []
            for bands_item_data in _bands:
                bands_item = BenchmarkGroupContextBandsBandsItem.from_dict(bands_item_data)

                bands.append(bands_item)

        unknown_runs = d.pop("unknownRuns", UNSET)

        distinct_bands = d.pop("distinctBands", UNSET)

        mixed = d.pop("mixed", UNSET)

        benchmark_group_context_bands = cls(
            bands=bands,
            unknown_runs=unknown_runs,
            distinct_bands=distinct_bands,
            mixed=mixed,
        )

        benchmark_group_context_bands.additional_properties = d
        return benchmark_group_context_bands

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
