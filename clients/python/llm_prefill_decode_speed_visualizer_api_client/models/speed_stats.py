from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.speed_stats_ci_95 import SpeedStatsCi95


T = TypeVar("T", bound="SpeedStats")


@_attrs_define
class SpeedStats:
    """Outlier-resistant distribution stats for one metric within a group.

    Attributes:
        median (float | None):
        q1 (float | None | Unset): First quartile
        q3 (float | None | Unset): Third quartile
        min_ (float | None | Unset):
        max_ (float | None | Unset):
        ci95 (SpeedStatsCi95 | Unset): 95% percentile bootstrap confidence interval (2,000 resamples). Overlapping
            intervals across groups mean they are statistically tied.
        label (None | str | Unset): Rendered as "median [lo–hi]" Example: 105 [101–110].
    """

    median: float | None
    q1: float | None | Unset = UNSET
    q3: float | None | Unset = UNSET
    min_: float | None | Unset = UNSET
    max_: float | None | Unset = UNSET
    ci95: SpeedStatsCi95 | Unset = UNSET
    label: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        median: float | None
        median = self.median

        q1: float | None | Unset
        if isinstance(self.q1, Unset):
            q1 = UNSET
        else:
            q1 = self.q1

        q3: float | None | Unset
        if isinstance(self.q3, Unset):
            q3 = UNSET
        else:
            q3 = self.q3

        min_: float | None | Unset
        if isinstance(self.min_, Unset):
            min_ = UNSET
        else:
            min_ = self.min_

        max_: float | None | Unset
        if isinstance(self.max_, Unset):
            max_ = UNSET
        else:
            max_ = self.max_

        ci95: dict[str, Any] | Unset = UNSET
        if not isinstance(self.ci95, Unset):
            ci95 = self.ci95.to_dict()

        label: None | str | Unset
        if isinstance(self.label, Unset):
            label = UNSET
        else:
            label = self.label

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "median": median,
            }
        )
        if q1 is not UNSET:
            field_dict["q1"] = q1
        if q3 is not UNSET:
            field_dict["q3"] = q3
        if min_ is not UNSET:
            field_dict["min"] = min_
        if max_ is not UNSET:
            field_dict["max"] = max_
        if ci95 is not UNSET:
            field_dict["ci95"] = ci95
        if label is not UNSET:
            field_dict["label"] = label

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.speed_stats_ci_95 import SpeedStatsCi95

        d = dict(src_dict)

        def _parse_median(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        median = _parse_median(d.pop("median"))

        def _parse_q1(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        q1 = _parse_q1(d.pop("q1", UNSET))

        def _parse_q3(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        q3 = _parse_q3(d.pop("q3", UNSET))

        def _parse_min_(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        min_ = _parse_min_(d.pop("min", UNSET))

        def _parse_max_(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        max_ = _parse_max_(d.pop("max", UNSET))

        _ci95 = d.pop("ci95", UNSET)
        ci95: SpeedStatsCi95 | Unset
        if isinstance(_ci95, Unset):
            ci95 = UNSET
        else:
            ci95 = SpeedStatsCi95.from_dict(_ci95)

        def _parse_label(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        label = _parse_label(d.pop("label", UNSET))

        speed_stats = cls(
            median=median,
            q1=q1,
            q3=q3,
            min_=min_,
            max_=max_,
            ci95=ci95,
            label=label,
        )

        speed_stats.additional_properties = d
        return speed_stats

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
