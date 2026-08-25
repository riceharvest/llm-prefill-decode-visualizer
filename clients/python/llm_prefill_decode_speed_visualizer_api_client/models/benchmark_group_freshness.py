from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.benchmark_group_freshness_staleness_type_1 import BenchmarkGroupFreshnessStalenessType1
from ..models.benchmark_group_freshness_staleness_type_2_type_1 import BenchmarkGroupFreshnessStalenessType2Type1
from ..models.benchmark_group_freshness_staleness_type_3_type_1 import BenchmarkGroupFreshnessStalenessType3Type1
from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="BenchmarkGroupFreshness")



@_attrs_define
class BenchmarkGroupFreshness:
    """ Recency of the runs backing this group.

        Attributes:
            newest_run_at (datetime.datetime | None | Unset):
            oldest_run_at (datetime.datetime | None | Unset):
            newest_age_days (int | None | Unset):
            staleness (BenchmarkGroupFreshnessStalenessType1 | BenchmarkGroupFreshnessStalenessType2Type1 |
                BenchmarkGroupFreshnessStalenessType3Type1 | None | Unset):
            engine_versions (list[str] | Unset):
            major_release_warnings (list[str] | Unset):
     """

    newest_run_at: datetime.datetime | None | Unset = UNSET
    oldest_run_at: datetime.datetime | None | Unset = UNSET
    newest_age_days: int | None | Unset = UNSET
    staleness: BenchmarkGroupFreshnessStalenessType1 | BenchmarkGroupFreshnessStalenessType2Type1 | BenchmarkGroupFreshnessStalenessType3Type1 | None | Unset = UNSET
    engine_versions: list[str] | Unset = UNSET
    major_release_warnings: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        newest_run_at: None | str | Unset
        if isinstance(self.newest_run_at, Unset):
            newest_run_at = UNSET
        elif isinstance(self.newest_run_at, datetime.datetime):
            newest_run_at = self.newest_run_at.isoformat()
        else:
            newest_run_at = self.newest_run_at

        oldest_run_at: None | str | Unset
        if isinstance(self.oldest_run_at, Unset):
            oldest_run_at = UNSET
        elif isinstance(self.oldest_run_at, datetime.datetime):
            oldest_run_at = self.oldest_run_at.isoformat()
        else:
            oldest_run_at = self.oldest_run_at

        newest_age_days: int | None | Unset
        if isinstance(self.newest_age_days, Unset):
            newest_age_days = UNSET
        else:
            newest_age_days = self.newest_age_days

        staleness: None | str | Unset
        if isinstance(self.staleness, Unset):
            staleness = UNSET
        elif isinstance(self.staleness, BenchmarkGroupFreshnessStalenessType1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, BenchmarkGroupFreshnessStalenessType2Type1):
            staleness = self.staleness.value
        elif isinstance(self.staleness, BenchmarkGroupFreshnessStalenessType3Type1):
            staleness = self.staleness.value
        else:
            staleness = self.staleness

        engine_versions: list[str] | Unset = UNSET
        if not isinstance(self.engine_versions, Unset):
            engine_versions = self.engine_versions



        major_release_warnings: list[str] | Unset = UNSET
        if not isinstance(self.major_release_warnings, Unset):
            major_release_warnings = self.major_release_warnings




        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if newest_run_at is not UNSET:
            field_dict["newestRunAt"] = newest_run_at
        if oldest_run_at is not UNSET:
            field_dict["oldestRunAt"] = oldest_run_at
        if newest_age_days is not UNSET:
            field_dict["newestAgeDays"] = newest_age_days
        if staleness is not UNSET:
            field_dict["staleness"] = staleness
        if engine_versions is not UNSET:
            field_dict["engineVersions"] = engine_versions
        if major_release_warnings is not UNSET:
            field_dict["majorReleaseWarnings"] = major_release_warnings

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        def _parse_newest_run_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                newest_run_at_type_0 = datetime.datetime.fromisoformat(data)



                return newest_run_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        newest_run_at = _parse_newest_run_at(d.pop("newestRunAt", UNSET))


        def _parse_oldest_run_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                oldest_run_at_type_0 = datetime.datetime.fromisoformat(data)



                return oldest_run_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        oldest_run_at = _parse_oldest_run_at(d.pop("oldestRunAt", UNSET))


        def _parse_newest_age_days(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        newest_age_days = _parse_newest_age_days(d.pop("newestAgeDays", UNSET))


        def _parse_staleness(data: object) -> BenchmarkGroupFreshnessStalenessType1 | BenchmarkGroupFreshnessStalenessType2Type1 | BenchmarkGroupFreshnessStalenessType3Type1 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_1 = BenchmarkGroupFreshnessStalenessType1(data)



                return staleness_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_2_type_1 = BenchmarkGroupFreshnessStalenessType2Type1(data)



                return staleness_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                staleness_type_3_type_1 = BenchmarkGroupFreshnessStalenessType3Type1(data)



                return staleness_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BenchmarkGroupFreshnessStalenessType1 | BenchmarkGroupFreshnessStalenessType2Type1 | BenchmarkGroupFreshnessStalenessType3Type1 | None | Unset, data)

        staleness = _parse_staleness(d.pop("staleness", UNSET))


        engine_versions = cast(list[str], d.pop("engineVersions", UNSET))


        major_release_warnings = cast(list[str], d.pop("majorReleaseWarnings", UNSET))


        benchmark_group_freshness = cls(
            newest_run_at=newest_run_at,
            oldest_run_at=oldest_run_at,
            newest_age_days=newest_age_days,
            staleness=staleness,
            engine_versions=engine_versions,
            major_release_warnings=major_release_warnings,
        )


        benchmark_group_freshness.additional_properties = d
        return benchmark_group_freshness

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
