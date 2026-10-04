export class DurationPattern {
  readonly hourMinute: string;
  readonly minuteSecond: string;
  readonly twoDigitHours: boolean;

  constructor(samples: readonly string[]) {
    if (samples.length !== 7) throw new Error("Missing duration pattern samples");
    const full = samples[0]!;
    const hm = samples[1]!;
    const ms = samples[2]!;
    const hour = samples[3]!;
    const paddedHour = samples[4]!;
    const minute = samples[5]!;
    const second = samples[6]!;
    this.twoDigitHours = hm.startsWith(paddedHour);
    const hours = this.twoDigitHours ? paddedHour : hour;
    if (
      !hm.startsWith(hours) ||
      !hm.endsWith(minute) ||
      !ms.startsWith(minute) ||
      !ms.endsWith(second)
    )
      throw new Error("Invalid duration pattern samples");
    this.hourMinute = hm.slice(hours.length, hm.length - minute.length);
    this.minuteSecond = ms.slice(minute.length, ms.length - second.length);
    if (
      this.hourMinute === "" ||
      this.minuteSecond === "" ||
      full !== hours + this.hourMinute + minute + this.minuteSecond + second
    )
      throw new Error("Inconsistent duration pattern samples");
  }
}
