from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.confidence_grade import ConfidenceGrade
from ..types import UNSET, Unset

T = TypeVar("T", bound="Confidence")


@_attrs_define
class Confidence:
    """How much to trust one aggregate: sample size, decode-IQR width, outlier density, recency and an overall grade.

    Attributes:
        runs (int): Comparable runs backing this aggregate
        grade (ConfidenceGrade): low <3 runs; high ≥10 runs with ≤40% decode IQR spread; medium otherwise
        iqr_spread_pct (float | None | Unset): Decode IQR / median × 100; tighter is better
        outliers (int | Unset): Runs outside the 1.5×IQR fences
        newest_run_age_days (int | None | Unset):
        score (int | None | Unset): 0–100 composite of sample size, spread and outliers (when computed)
    """

    runs: int
    grade: ConfidenceGrade
    iqr_spread_pct: float | None | Unset = UNSET
    outliers: int | Unset = UNSET
    newest_run_age_days: int | None | Unset = UNSET
    score: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        runs = self.runs

        grade = self.grade.value

        iqr_spread_pct: float | None | Unset
        if isinstance(self.iqr_spread_pct, Unset):
            iqr_spread_pct = UNSET
        else:
            iqr_spread_pct = self.iqr_spread_pct

        outliers = self.outliers

        newest_run_age_days: int | None | Unset
        if isinstance(self.newest_run_age_days, Unset):
            newest_run_age_days = UNSET
        else:
            newest_run_age_days = self.newest_run_age_days

        score: int | None | Unset
        if isinstance(self.score, Unset):
            score = UNSET
        else:
            score = self.score

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "runs": runs,
                "grade": grade,
            }
        )
        if iqr_spread_pct is not UNSET:
            field_dict["iqrSpreadPct"] = iqr_spread_pct
        if outliers is not UNSET:
            field_dict["outliers"] = outliers
        if newest_run_age_days is not UNSET:
            field_dict["newestRunAgeDays"] = newest_run_age_days
        if score is not UNSET:
            field_dict["score"] = score

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        runs = d.pop("runs")

        grade = ConfidenceGrade(d.pop("grade"))

        def _parse_iqr_spread_pct(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        iqr_spread_pct = _parse_iqr_spread_pct(d.pop("iqrSpreadPct", UNSET))

        outliers = d.pop("outliers", UNSET)

        def _parse_newest_run_age_days(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        newest_run_age_days = _parse_newest_run_age_days(d.pop("newestRunAgeDays", UNSET))

        def _parse_score(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        score = _parse_score(d.pop("score", UNSET))

        confidence = cls(
            runs=runs,
            grade=grade,
            iqr_spread_pct=iqr_spread_pct,
            outliers=outliers,
            newest_run_age_days=newest_run_age_days,
            score=score,
        )

        confidence.additional_properties = d
        return confidence

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
