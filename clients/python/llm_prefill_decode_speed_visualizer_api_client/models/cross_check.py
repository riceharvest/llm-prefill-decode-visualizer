from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.contradiction import Contradiction





T = TypeVar("T", bound="CrossCheck")



@_attrs_define
class CrossCheck:
    """ Sanity comparison of multi-GPU rigs against the single-GPU baseline on the same model/quant.

        Attributes:
            related_rig_comparisons (int): Number of multi-GPU comparisons performed
            contradictions (list[Contradiction]):
     """

    related_rig_comparisons: int
    contradictions: list[Contradiction]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.contradiction import Contradiction
        related_rig_comparisons = self.related_rig_comparisons

        contradictions = []
        for contradictions_item_data in self.contradictions:
            contradictions_item = contradictions_item_data.to_dict()
            contradictions.append(contradictions_item)




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "relatedRigComparisons": related_rig_comparisons,
            "contradictions": contradictions,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.contradiction import Contradiction
        d = dict(src_dict)
        related_rig_comparisons = d.pop("relatedRigComparisons")

        contradictions = []
        _contradictions = d.pop("contradictions")
        for contradictions_item_data in (_contradictions):
            contradictions_item = Contradiction.from_dict(contradictions_item_data)



            contradictions.append(contradictions_item)


        cross_check = cls(
            related_rig_comparisons=related_rig_comparisons,
            contradictions=contradictions,
        )


        cross_check.additional_properties = d
        return cross_check

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
