<?php

namespace App\Exceptions;

/**
 * Domain error with a stable machine-readable code and HTTP status.
 */
class InventoryException extends \RuntimeException
{
    /** @param array<string, mixed>|null $details */
    public function __construct(
        private string $errorCode,
        string $message,
        private int $httpStatus = 422,
        private ?array $details = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, $httpStatus, $previous);
    }

    public static function validation(string $message, ?array $details = null): self
    {
        return new self('validation_failed', $message, 422, $details);
    }

    public static function notFound(string $message): self
    {
        return new self('not_found', $message, 404);
    }

    public static function conflict(string $message, ?array $details = null): self
    {
        return new self('conflict', $message, 409, $details);
    }

    public static function forbidden(string $message): self
    {
        return new self('forbidden', $message, 403);
    }

    public static function negativeStock(string $message, array $details): self
    {
        return new self('negative_stock_blocked', $message, 422, $details);
    }

    public static function periodLocked(string $message, array $details): self
    {
        return new self('period_locked', $message, 422, $details);
    }

    public static function invalidState(string $message, array $details = []): self
    {
        return new self('invalid_state', $message, 409, $details);
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }

    public function httpStatus(): int
    {
        return $this->httpStatus;
    }

    /** @return array<string, mixed>|null */
    public function details(): ?array
    {
        return $this->details;
    }
}
