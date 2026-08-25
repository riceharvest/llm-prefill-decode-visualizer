from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.best_result_context_bands_bands_item_band import BestResultContextBandsBandsItemBand
from ..types import UNSET, Unset






T = TypeVar("T", bound="BestResultContextBandsBandsItem")



@_attrs_define
class BestResultContextBandsBandsItem:
    """ 
        Attributes:
            band (BestResultContextBandsBandsItemBand | Unset):
            label (str | Unset): Display label, e.g. "8k–32k"
            runs (int | Unset):
     """

    band: BestResultContextBandsBandsItemBand | Unset = UNSET
    label: str | Unset = UNSET
    runs: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        band: str | Unset = UNSET
        if not isinstance(self.band, Unset):
            band = self.band.value


        label = self.label

        runs = self.runs


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if band is not UNSET:
            field_dict["band"] = band
        if label is not UNSET:
            field_dict["label"] = label
        if runs is not UNSET:
            field_dict["runs"] = runs

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _band = d.pop("band", UNSET)
        band: BestResultContextBandsBandsItemBand | Unset
        if isinstance(_band,  Unset):
            band = UNSET
        else:
            band = BestResultContextBandsBandsItemBand(_band)




        label = d.pop("label", UNSET)

        runs = d.pop("runs", UNSET)

        best_result_context_bands_bands_item = cls(
            band=band,
            label=label,
            runs=runs,
        )


        best_result_context_bands_bands_item.additional_properties = d
        return best_result_context_bands_bands_item

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
