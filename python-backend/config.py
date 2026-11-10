"""Application configuration for ResistoDiff-3D Python backend.

Uses pydantic-settings for type-safe, environment-variable-overridable
configuration with sensible defaults for local development.

All settings can be overridden via environment variables prefixed with
``RESISTODIFF_`` (e.g. ``RESISTODIFF_PORT=9000``).
"""
from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the ResistoDiff-3D FastAPI backend.

    Attributes
    ----------
    port : int
        Port on which the Uvicorn server listens.
    host : str
        Bind address for the Uvicorn server.
    debug : bool
        Enable debug mode (verbose logging, stack traces in responses).
    dataset_path : Path
        Root directory for bio-target dataset storage.
    cors_origins : List[str]
        Allowed CORS origins. ``["*"]`` permits all origins (dev only).
    rcsb_base_url : str
        Base URL for the RCSB PDB REST API.
    cache_ttl_seconds : int
        Time-to-live for in-memory caches in seconds.
    md_default_steps : int
        Default number of MD simulation steps.
    md_default_dt : float
        Default MD integration timestep in ps.
    diffusion_default_steps : int
        Default number of diffusion denoising steps.
    diffusion_default_molecules : int
        Default number of molecules to generate.
    diffusion_default_guidance : float
        Default classifier-free guidance scale.
    log_level : str
        Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL).
    """

    model_config = SettingsConfigDict(
        env_prefix="RESISTODIFF_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Server ────────────────────────────────────────────────────────
    port: int = Field(default=8000, ge=1, le=65535, description="Uvicin listen port")
    host: str = Field(default="0.0.0.0", description="Bind address")
    debug: bool = Field(default=False, description="Enable debug mode")

    # ── Paths ─────────────────────────────────────────────────────────
    dataset_path: Path = Field(
        default=Path(__file__).resolve().parent / "data" / "bio_targets",
        description="Root directory for bio-target dataset storage",
    )

    # ── CORS ──────────────────────────────────────────────────────────
    cors_origins: List[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        description="Allowed CORS origins",
    )

    # ── External APIs ─────────────────────────────────────────────────
    rcsb_base_url: str = Field(
        default="https://data.rcsb.org/rest/v1/core/entry",
        description="RCSB PDB REST API base URL",
    )

    # ── Caching ───────────────────────────────────────────────────────
    cache_ttl_seconds: int = Field(
        default=3600,
        ge=60,
        description="In-memory cache TTL in seconds",
    )

    # ── MD Simulation defaults ────────────────────────────────────────
    md_default_steps: int = Field(default=500, ge=10, le=50000, description="Default MD steps")
    md_default_dt: float = Field(default=0.002, ge=0.0005, le=0.01, description="Default MD timestep (ps)")

    # ── SE(3) Diffusion defaults ─────────────────────────────────────
    diffusion_default_steps: int = Field(default=50, ge=5, le=1000, description="Default diffusion steps")
    diffusion_default_molecules: int = Field(default=6, ge=1, le=100, description="Default molecules to generate")
    diffusion_default_guidance: float = Field(default=5.0, ge=1.0, le=20.0, description="Default guidance scale")

    # ── Logging ───────────────────────────────────────────────────────
    log_level: str = Field(default="INFO", description="Logging level")

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Ensure the log level is one of the standard Python levels."""
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = v.upper()
        if upper not in allowed:
            raise ValueError(f"log_level must be one of {allowed}, got '{v}'")
        return upper

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v) -> List[str]:  # type: ignore[valid-type]
        """Parse CORS origins from string or list."""
        if isinstance(v, str):
            # Allow comma-separated string
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v


# ── Singleton instance ────────────────────────────────────────────────

def get_settings() -> Settings:
    """Return the cached Settings singleton.

    Uses a module-level cache so the same instance is reused across
    all imports within the process.
    """
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = Settings()
    return _settings


_settings: Settings | None = None
