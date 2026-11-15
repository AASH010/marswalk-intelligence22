"""MEDA weather pipeline (Task 1): raw MEDA PDS4 products -> versioned, offline products.

Task 2 must consume only the outputs written by this package, never raw MEDA data.
"""

__version__ = "1.0.0"
SCHEMA_VERSION = "1.0"


class ExitCode:
    OK = 0
    UNEXPECTED = 1  # not part of the contract; any unhandled exception
    BAD_CONFIG = 2
    MISSING_INPUT = 3
    VALIDATION_FAILED = 4


class WeatherError(Exception):
    exit_code = ExitCode.UNEXPECTED


class ConfigError(WeatherError):
    """Bad configuration or CLI arguments."""

    exit_code = ExitCode.BAD_CONFIG


class InputError(WeatherError):
    """Missing, malformed or corrupted input."""

    exit_code = ExitCode.MISSING_INPUT


class ValidationFailure(WeatherError):
    """Outputs failed validation."""

    exit_code = ExitCode.VALIDATION_FAILED


class UnitError(WeatherError):
    """No documented conversion exists for a unit pair."""
