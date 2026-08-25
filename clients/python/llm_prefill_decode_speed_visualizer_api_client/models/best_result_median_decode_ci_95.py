from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="BestResultMedianDecodeCi95")



@_attrs_define
class BestResultMedianDecodeCi95:
    """ 95% percentile bootstrap confidence interval (2,000 resamples). Overlapping intervals across groups mean they are
    statistically tied.

        Attributes:
            lo (float): 2.5th percentile
            hi (float): 97.5th percentile
     """

    lo: float
    hi: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        lo = self.lo

        hi = self.hi


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "lo": lo,
            "hi": hi,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        lo = d.pop("lo")

        hi = d.pop("hi")

        best_result_median_decode_ci_95 = cls(
            lo=lo,
            hi=hi,
        )


        best_result_median_decode_ci_95.additional_properties = d
        return best_result_median_decode_ci_95

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
